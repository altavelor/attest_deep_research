import {
  ChatMessage,
  ChatRequest,
  ChatToolCall,
  ModelRoundDelta,
  ModelRoundProvider,
  ModelToolOutput,
  ProviderContinuationState,
} from "@core/agent";
import type { ModelRoundRequest } from "@core/agent";
import type { ToolManager } from "@application/tools/ToolManager";
import type { ResearchExecutionPolicy } from "@core/research";

export interface ThinkingModelRoundCollectorOptions {
  model: string;
  tools: ToolManager;
  policy: ResearchExecutionPolicy;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  reasoning?: ModelRoundRequest["reasoning"];
  onDelta?(delta: ModelRoundDelta, round: number): void;
}

export interface ThinkingModelRound {
  content: string;
  toolCalls: ChatToolCall[];
  continuation?: ProviderContinuationState;
  stopReason: "complete" | "tool_calls" | "length" | "error";
  reasoningItemCount: number;
  reasoningSegments: { segmentId: string; chars: number }[];
  usage: { inputTokens: number; outputTokens: number; reasoningTokens: number };
  streamedText: boolean;
}

/** Runs one model round and normalizes streamed and final reasoning into one response. */
export async function collectThinkingModelRound(
  options: ThinkingModelRoundCollectorOptions,
  modelRound: ModelRoundProvider,
  messages: ChatMessage[],
  toolChoice: ChatRequest["toolChoice"],
  continuation?: ProviderContinuationState,
  toolOutputs?: ModelToolOutput[],
  round = 1,
): Promise<ThinkingModelRound> {
  let streamedText = false;
  let streamedReasoning = false;
  const segmentChars = new Map<string, number>();
  const recordSegment = (segmentId: string | undefined, text: string): void => {
    if (!segmentId) return;
    segmentChars.set(segmentId, (segmentChars.get(segmentId) ?? 0) + text.length);
  };
  const result = await modelRound.runRound({
    model: options.model,
    messages,
    tools: options.tools.definitions(),
    toolChoice,
    parallelToolCalls: options.policy.parallelToolCalls,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    signal: options.signal,
    continuation,
    toolOutputs,
    reasoning: options.reasoning,
    onDelta: (delta) => {
      if (delta.type === "text") streamedText = true;
      else streamedReasoning = true;
      const forwarded: ModelRoundDelta =
        delta.type === "reasoningSummary" && delta.segmentId
          ? { ...delta, segmentId: `round-${round}-${delta.segmentId}` }
          : delta;
      if (forwarded.type === "reasoningSummary") {
        recordSegment(forwarded.segmentId, forwarded.text);
      }
      options.onDelta?.(forwarded, round);
    },
  });
  const content = result.items
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("");
  if (!streamedText && content) {
    streamedText = true;
    options.onDelta?.({ type: "text", text: content }, round);
  }
  if (!streamedReasoning) {
    const summaries = result.items.filter((item) => item.type === "reasoningSummary");
    for (let index = 0; index < summaries.length; index += 1) {
      const segmentId = `reasoning-${round}-${index}`;
      recordSegment(segmentId, summaries[index].text);
      options.onDelta?.(
        { type: "reasoningSummary", segmentId, text: summaries[index].text },
        round,
      );
    }
  }
  return {
    content,
    toolCalls: result.items.filter((item) => item.type === "toolCall").map((item) => item.call),
    continuation: result.continuation,
    stopReason: result.stopReason,
    reasoningItemCount: result.reasoningItemCount ?? 0,
    reasoningSegments: [...segmentChars].map(([segmentId, chars]) => ({ segmentId, chars })),
    usage: result.usage ?? { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
    streamedText,
  };
}
