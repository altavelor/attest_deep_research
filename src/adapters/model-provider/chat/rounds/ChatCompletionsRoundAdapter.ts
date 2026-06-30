import { ChatModelProvider, ModelOutputItem, ModelRoundProvider, ModelRoundRequest, ModelRoundResult } from "../../../../core/agent/protocol";
import { IxplorerError } from "../../../../core/errors";

export class ChatCompletionsRoundAdapter implements ModelRoundProvider {
  constructor(private readonly chatModel: ChatModelProvider) { }

  listModels(): Promise<string[]> {
    return this.chatModel.listModels();
  }

  async runRound(request: ModelRoundRequest): Promise<ModelRoundResult> {
    if (request.continuation || request.toolOutputs) {
      throw new IxplorerError({
        code: "UNSUPPORTED_CAPABILITY",
        message: "Chat Completions does not support opaque Responses continuation.",
      });
    }
    const items: ModelOutputItem[] = [];
    let completed = false;
    let stopReason: ModelRoundResult["stopReason"] = "complete";
    let usage: ModelRoundResult["usage"];
    const reasoningItems = new Map<
      string,
      Extract<ModelOutputItem, { type: "reasoningSummary" }>
    >();

    for await (const chunk of this.chatModel.streamChat(request)) {
      if (completed) {
        throw new IxplorerError({
          code: "MODEL_PROVIDER_UNAVAILABLE",
          message: "The chat provider emitted data after completing a model round.",
        });
      }
      if (chunk.events?.length) {
        for (const event of chunk.events) {
          request.onEvent?.(event);
          if (event.type === "reasoning-delta") {
            const current = reasoningItems.get(event.segmentId);
            if (current) current.text += event.text;
            else {
              const item = { type: "reasoningSummary" as const, text: event.text };
              reasoningItems.set(event.segmentId, item);
              items.push(item);
            }
            request.onDelta?.({
              type: "reasoningSummary",
              text: event.text,
              segmentId: event.segmentId,
            });
          } else if (event.type === "text-delta") {
            items.push({ type: "text", text: event.text });
            request.onDelta?.({ type: "text", text: event.text });
          } else if (event.type === "usage") {
            usage = event;
          } else if (event.type === "complete") {
            completed = true;
            stopReason = event.stopReason;
          }
        }
      } else if (chunk.content) {
        items.push({ type: "text", text: chunk.content });
        request.onDelta?.({ type: "text", text: chunk.content });
      }
      if (chunk.toolCalls) {
        items.push(...chunk.toolCalls.map((call) => ({ type: "toolCall" as const, call })));
      }
      if (chunk.isComplete) completed = true;
    }

    if (!completed) {
      throw new IxplorerError({
        code: "MODEL_PROVIDER_UNAVAILABLE",
        message: "The chat provider ended before completing a model round.",
      });
    }
    return {
      items,
      stopReason: items.some((item) => item.type === "toolCall") ? "tool_calls" : stopReason,
      ...(usage
        ? {
          usage: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            reasoningTokens: usage.reasoningTokens,
          },
        }
        : {}),
      ...(reasoningItems.size > 0 ? { reasoningItemCount: reasoningItems.size } : {}),
    };
  }
}
