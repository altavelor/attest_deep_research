import type {
  AbortableAsyncIterator,
  ChatResponse as OllamaChatResponse,
  Message as OllamaMessage,
  Ollama,
} from "ollama";

import { ChatRequest, ChatResponseChunk, ModelStreamEvent } from "@core/agent";
import { AttestError } from "@core/errors";
import { isRecord } from "@shared";
import { mapOllamaMessage } from "../providers/messageMappers";
import { textFromEvents, ToolCallBuilder } from "./chatStreamPrimitives";
import { RepetitionDetector } from "./repetitionDetector";
import { parseTextToolCalls } from "./textToolCalls";

interface OllamaChatStreamOptions {
  ollama: Ollama;
  apiKey?: string;
  request: ChatRequest;
}

export async function listOllamaModels(
  ollama: Ollama,
  apiKey: string | undefined,
): Promise<string[]> {
  let body: Awaited<ReturnType<Ollama["list"]>>;
  try {
    body = await ollama.list();
  } catch (error) {
    throw translateOllamaError(error, apiKey);
  }

  return body.models
    .map((model) => model.name || model.model)
    .filter((name): name is string => typeof name === "string" && name.length > 0);
}

export async function* streamOllamaChat({
  ollama,
  apiKey,
  request,
}: OllamaChatStreamOptions): AsyncIterable<ChatResponseChunk> {
  validateOllamaToolChoice(request);
  const hasTools =
    request.toolChoice?.type !== "none" && request.tools !== undefined && request.tools.length > 0;
  const options =
    request.temperature === undefined && request.maxTokens === undefined
      ? undefined
      : { temperature: request.temperature, num_predict: request.maxTokens };

  let stream: AbortableAsyncIterator<OllamaChatResponse>;
  try {
    stream = await ollama.chat({
      model: request.model,
      messages: request.messages.map(mapOllamaMessage) as unknown as OllamaMessage[],
      stream: true,
      ...(hasTools ? { tools: request.tools } : {}),
      ...(request.reasoningEnabled ? { think: ollamaThink(request.reasoningEffort) } : {}),
      ...(options ? { options } : {}),
    });
  } catch (error) {
    throw translateOllamaError(error, apiKey);
  }

  if (request.signal) {
    if (request.signal.aborted) stream.abort();
    else request.signal.addEventListener("abort", () => stream.abort(), { once: true });
  }

  const toolCallBuilder = new ToolCallBuilder();
  const repetition = new RepetitionDetector();
  const reasoningSegmentId = "reasoning-0";
  let reasoningOpen = false;
  let sawNativeToolCall = false;
  let fullContent = "";

  try {
    for await (const part of stream) {
      const events: ModelStreamEvent[] = [];
      const thinking = part.message?.thinking;
      if (thinking) {
        if (!reasoningOpen) {
          reasoningOpen = true;
          events.push({
            type: "reasoning-start",
            segmentId: reasoningSegmentId,
            visibility: "text",
          });
        }
        events.push({ type: "reasoning-delta", segmentId: reasoningSegmentId, text: thinking });
      }
      const content = part.message?.content ?? "";
      if (content) {
        if (reasoningOpen) {
          reasoningOpen = false;
          events.push({ type: "reasoning-end", segmentId: reasoningSegmentId });
        }
        fullContent += content;
        repetition.push(content);
        events.push({ type: "text-delta", text: content });
      }
      for (const toolCall of part.message?.tool_calls ?? []) {
        sawNativeToolCall = true;
        toolCallBuilder.add({
          name: toolCall.function.name,
          argumentsText: JSON.stringify(toolCall.function.arguments ?? {}),
        });
      }
      if (events.length > 0) {
        yield { content: textFromEvents(events), isComplete: false, events };
      }

      if (part.done || repetition.isRepeating()) {
        const finalEvents: ModelStreamEvent[] = [];
        if (reasoningOpen) {
          finalEvents.push({ type: "reasoning-end", segmentId: reasoningSegmentId });
        }
        finalEvents.push({ type: "complete", stopReason: "complete" });
        let toolCalls = toolCallBuilder.build();
        if (!sawNativeToolCall && toolCalls.length === 0) {
          for (const textCall of parseTextToolCalls(fullContent, request.tools)) {
            toolCallBuilder.add({
              id: textCall.id,
              name: textCall.name,
              argumentsText: JSON.stringify(textCall.arguments),
            });
          }
          toolCalls = toolCallBuilder.build();
        }
        yield {
          content: textFromEvents(finalEvents),
          isComplete: true,
          events: finalEvents,
          ...(toolCalls.length > 0 ? { toolCalls } : {}),
        };
        return;
      }
    }
  } catch (error) {
    throw translateOllamaError(error, apiKey);
  }

  yield { content: "", isComplete: true, events: [{ type: "complete", stopReason: "complete" }] };
}

export function normalizeOllamaHost(baseUrl: string): string {
  return baseUrl
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/api$/, "");
}

function ollamaThink(effort: string | undefined): boolean | "high" | "medium" | "low" {
  if (effort === "high" || effort === "medium" || effort === "low") return effort;
  return true;
}

function translateOllamaError(error: unknown, apiKey: string | undefined): AttestError | never {
  if (error instanceof AttestError) return error;
  if (error instanceof Error && error.name === "AbortError") throw error;
  const status =
    isRecord(error) && typeof error.status_code === "number" ? error.status_code : undefined;
  if (status === 404) {
    return new AttestError({ code: "MODEL_NOT_FOUND", details: { status } });
  }
  const message =
    isRecord(error) && typeof error.error === "string"
      ? sanitizeOllamaMessage(error.error, apiKey)
      : undefined;
  return new AttestError({
    code: "MODEL_PROVIDER_UNAVAILABLE",
    message: "The chat model provider is unavailable.",
    ...(status !== undefined || message
      ? {
          details: {
            ...(status !== undefined ? { status } : {}),
            ...(message ? { providerMessage: message } : {}),
          },
        }
      : {}),
    cause: error,
  });
}

function sanitizeOllamaMessage(value: string, apiKey: string | undefined): string {
  const normalized = value.replace(/\s+/g, " ").trim().slice(0, 500);
  return apiKey ? normalized.split(apiKey).join("[redacted]") : normalized;
}

function validateOllamaToolChoice(request: ChatRequest): void {
  if (request.toolChoice?.type === "required" || request.toolChoice?.type === "specific") {
    throw new AttestError({
      code: "UNSUPPORTED_CAPABILITY",
      message: "Ollama does not support required or specific tool choice.",
    });
  }
}
