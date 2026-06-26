import { ProviderHttpClient } from "../common/http";
import { parseServerSentEvents } from "../common/streams";
import { isRecord } from "../../../shared/guards";
import { ChatMessage, ModelRoundProvider, ModelRoundRequest, ModelRoundResult, ModelStreamEvent, ModelToolOutput, ProviderContinuationState } from "../../../core/agent/protocol";
import { ChatToolChoice, ChatToolDefinition } from "../../../core/agent/tool";
import type { PluginRequestLogger } from "../../settings/debugLogger";
import { IxplorerError } from "../../../core/errors";
import { parseResponsesTerminalEvent, protocolError } from "./OpenAiResponsesStreamParser";

export interface OpenAiResponsesClientOptions {
  baseUrl: string;
  apiKey?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  logger?: PluginRequestLogger;
  reasoningEfforts?: readonly string[];
  reasoningSummary?: boolean;
}

interface ContinuationPayload {
  input: unknown[];
  pendingCalls: string[];
  reasoningEnabled: boolean;
}

class ResponsesContinuation implements ProviderContinuationState {
  readonly provider = "openai-compatible" as const;
  disposed = false;
  constructor(private onDispose?: () => void) { }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const dispose = this.onDispose;
    this.onDispose = undefined;
    dispose?.();
  }
}

export class OpenAiResponsesClient implements ModelRoundProvider {
  private readonly http: ProviderHttpClient;
  private readonly continuations = new WeakMap<ResponsesContinuation, ContinuationPayload>();
  private readonly reasoningEfforts: Set<string>;
  private readonly reasoningSummary: boolean;

  constructor(options: OpenAiResponsesClientOptions) {
    this.http = new ProviderHttpClient({
      ...options,
      apiFormat: "openai-compatible",
      unavailableCode: "MODEL_PROVIDER_UNAVAILABLE",
      unavailableMessage: "The Responses provider is unavailable.",
    });
    this.reasoningEfforts = new Set(options.reasoningEfforts ?? []);
    this.reasoningSummary = options.reasoningSummary === true;
  }

  async listModels(): Promise<string[]> {
    const response = await this.http.request("/models", { method: "GET" });
    const body = await this.http.readJson(
      response,
      "The Responses provider returned invalid JSON.",
    );
    if (!isRecord(body) || !Array.isArray(body.data))
      throw protocolError("responses-invalid-model-list");
    return body.data.flatMap((item) =>
      isRecord(item) && typeof item.id === "string" ? [item.id] : [],
    );
  }

  async runRound(request: ModelRoundRequest): Promise<ModelRoundResult> {
    validateReasoning(request, this.reasoningEfforts, this.reasoningSummary);
    const instructions =
      request.messages
        .filter((message) => message.role === "system")
        .map((message) => message.content)
        .join("\n\n") || undefined;
    const continuation = request.continuation
      ? this.readContinuation(request.continuation)
      : undefined;
    const bootstrapInput = continuation?.input ?? mapMessages(request.messages);
    const toolOutputs = continuation
      ? orderToolOutputs(continuation.pendingCalls, request.toolOutputs ?? [])
      : [];
    if (!continuation && request.toolOutputs?.length)
      throw unsupported("Tool outputs require a Responses continuation.");
    const input = [...bootstrapInput, ...toolOutputs.map(mapToolOutput)];
    const body = {
      model: request.model,
      ...(instructions ? { instructions } : {}),
      input,
      store: false,
      stream: true,
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.maxTokens !== undefined ? { max_output_tokens: request.maxTokens } : {}),
      ...(request.tools?.length ? { tools: request.tools.map(mapTool) } : {}),
      ...(request.toolChoice
        ? { tool_choice: mapToolChoice(request.toolChoice, request.tools ?? []) }
        : {}),
      ...(request.parallelToolCalls !== undefined
        ? { parallel_tool_calls: request.parallelToolCalls }
        : {}),
      ...(request.reasoning?.enabled
        ? {
          reasoning: {
            ...(request.reasoning.effort ? { effort: request.reasoning.effort } : {}),
            ...(request.reasoning.summary === "auto" ? { summary: "auto" } : {}),
          },
          include: ["reasoning.encrypted_content"],
        }
        : {}),
    };
    const response = await this.http.request(
      "/responses",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: request.signal,
      },
      { redactBody: true },
    );
    if (!response.body) throw protocolError("responses-empty-stream");

    let terminal: ReturnType<typeof parseResponsesTerminalEvent>;
    const streamedText: string[] = [];
    let streamedReasoning = false;
    const openReasoning = new Set<string>();
    const emitNormalized = (event: ModelStreamEvent): void => {
      request.onEvent?.(event);
      if (event.type === "text-delta") request.onDelta?.({ type: "text", text: event.text });
      else if (event.type === "reasoning-delta") {
        request.onDelta?.({
          type: "reasoningSummary",
          text: event.text,
          segmentId: event.segmentId,
        });
      }
    };
    const closeReasoning = (): void => {
      for (const segmentId of openReasoning) {
        emitNormalized({ type: "reasoning-end", segmentId });
      }
      openReasoning.clear();
    };
    for await (const raw of parseServerSentEvents(response.body)) {
      if (raw === "[DONE]") {
        if (!terminal) throw protocolError("responses-done-before-terminal");
        break;
      }
      if (terminal) throw protocolError("responses-data-after-terminal");
      let event: unknown;
      try {
        event = JSON.parse(raw);
      } catch {
        throw protocolError("responses-invalid-sse-json");
      }
      const normalized = parseResponsesDelta(event);
      if (normalized?.type === "reasoning-delta") {
        streamedReasoning = true;
        if (!openReasoning.has(normalized.segmentId)) {
          openReasoning.add(normalized.segmentId);
          emitNormalized({
            type: "reasoning-start",
            segmentId: normalized.segmentId,
            visibility: normalized.visibility,
          });
        }
        emitNormalized(normalized);
      } else if (normalized?.type === "text-delta") {
        closeReasoning();
        streamedText.push(normalized.text);
        emitNormalized(normalized);
      }
      const parsed = parseResponsesTerminalEvent(event);
      if (!parsed) continue;
      terminal = parsed;
    }
    if (!terminal) throw protocolError("responses-stream-truncated");
    const terminalText = terminal.result.items
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("");
    if (streamedText.length > 0 && streamedText.join("") !== terminalText) {
      throw protocolError("responses-stream-text-mismatch");
    }
    closeReasoning();
    if (!streamedReasoning) {
      for (const [index, item] of terminal.result.items
        .filter((item) => item.type === "reasoningSummary")
        .entries()) {
        const segmentId = `reasoning-terminal-${index}`;
        emitNormalized({ type: "reasoning-start", segmentId, visibility: "summary" });
        emitNormalized({ type: "reasoning-delta", segmentId, text: item.text });
        emitNormalized({ type: "reasoning-end", segmentId });
      }
    }
    if (streamedText.length === 0 && terminalText) {
      emitNormalized({ type: "text-delta", text: terminalText });
    }
    if (terminal.result.usage) {
      emitNormalized({ type: "usage", ...terminal.result.usage });
    }
    emitNormalized({ type: "complete", stopReason: terminal.result.stopReason });

    const pendingCalls = terminal.result.items
      .filter((item) => item.type === "toolCall")
      .map((item) => item.call.id);
    if (pendingCalls.length > 0) {
      let state!: ResponsesContinuation;
      state = new ResponsesContinuation(() => this.continuations.delete(state));
      this.continuations.set(state, {
        input: [...input, ...terminal.providerOutput],
        pendingCalls,
        reasoningEnabled: request.reasoning?.enabled === true,
      });
      terminal.result.continuation = state;
    }
    return terminal.result;
  }

  private readContinuation(state: ProviderContinuationState): ContinuationPayload {
    if (!(state instanceof ResponsesContinuation) || state.disposed) {
      throw unsupported("The Responses continuation is invalid or disposed.");
    }
    const payload = this.continuations.get(state);
    if (!payload) throw unsupported("The Responses continuation belongs to another answer scope.");
    state.dispose();
    this.continuations.delete(state);
    return payload;
  }
}

type ResponsesDelta =
  | Extract<ModelStreamEvent, { type: "text-delta" }>
  | (Extract<ModelStreamEvent, { type: "reasoning-delta" }> & {
    visibility: "text" | "summary";
  });

function parseResponsesDelta(value: unknown): ResponsesDelta | undefined {
  if (!isRecord(value) || typeof value.delta !== "string" || !value.delta) return undefined;
  if (value.type === "response.output_text.delta") {
    return { type: "text-delta", text: value.delta };
  } else if (
    value.type === "response.reasoning.delta" ||
    value.type === "response.reasoning_text.delta"
  ) {
    const outputIndex =
      typeof value.output_index === "number" && value.output_index >= 0 ? value.output_index : 0;
    return {
      type: "reasoning-delta",
      text: value.delta,
      segmentId: `reasoning-${outputIndex}-text`,
      visibility: "text",
    };
  } else if (value.type === "response.reasoning_summary_text.delta") {
    const outputIndex =
      typeof value.output_index === "number" && value.output_index >= 0 ? value.output_index : 0;
    const summaryIndex =
      typeof value.summary_index === "number" && value.summary_index >= 0 ? value.summary_index : 0;
    return {
      type: "reasoning-delta",
      text: value.delta,
      segmentId: `reasoning-${outputIndex}-${summaryIndex}`,
      visibility: "summary",
    };
  }
  return undefined;
}

function validateReasoning(
  request: ModelRoundRequest,
  efforts: Set<string>,
  summary: boolean,
): void {
  const reasoning = request.reasoning;
  if (!reasoning?.enabled) return;
  if (reasoning.effort && !efforts.has(reasoning.effort))
    throw unsupported("The selected reasoning effort is not capability-verified.");
  if (reasoning.summary === "auto" && !summary)
    throw unsupported("Reasoning summaries are not capability-verified.");
}

function mapMessages(messages: ChatMessage[]): unknown[] {
  const input: unknown[] = [];
  for (const message of messages) {
    if (message.role === "system") continue;
    if (message.role === "tool") {
      if (!message.toolCallId) throw unsupported("A tool message is missing its call ID.");
      input.push({
        type: "function_call_output",
        call_id: message.toolCallId,
        output: message.content,
      });
      continue;
    }
    input.push({
      type: "message",
      role: message.role,
      content: [
        message.role === "assistant"
          ? { type: "output_text", text: message.content, annotations: [] }
          : { type: "input_text", text: message.content },
      ],
      ...(message.role === "assistant" ? { status: "completed" } : {}),
    });
    for (const call of message.toolCalls ?? []) {
      input.push({
        type: "function_call",
        call_id: call.id,
        name: call.name,
        arguments: JSON.stringify(call.arguments),
      });
    }
  }
  return input;
}

function mapTool(tool: ChatToolDefinition): Record<string, unknown> {
  return {
    type: "function",
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
    strict: false,
  };
}

function mapToolChoice(choice: ChatToolChoice, tools: ChatToolDefinition[]): unknown {
  if (choice.type !== "specific") return choice.type;
  if (!tools.some((tool) => tool.function.name === choice.name))
    throw unsupported(`Unknown specific tool: ${choice.name}`);
  return { type: "function", name: choice.name };
}

function orderToolOutputs(pending: string[], outputs: ModelToolOutput[]): ModelToolOutput[] {
  const byId = new Map<string, ModelToolOutput>();
  for (const output of outputs) {
    if (byId.has(output.callId) || !pending.includes(output.callId))
      throw unsupported("Responses tool outputs do not match pending calls.");
    byId.set(output.callId, output);
  }
  if (byId.size !== pending.length)
    throw unsupported("Every pending Responses call requires exactly one output.");
  return pending.map((id) => byId.get(id)!);
}

function mapToolOutput(output: ModelToolOutput): Record<string, unknown> {
  return {
    type: "function_call_output",
    id: `fco_${output.callId}`,
    call_id: output.callId,
    output: output.output,
  };
}

function unsupported(message: string): IxplorerError {
  return new IxplorerError({ code: "UNSUPPORTED_CAPABILITY", message });
}
