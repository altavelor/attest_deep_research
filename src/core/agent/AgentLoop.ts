// Core agent loop (stage 3). The model<->tools round loop, depending only on the
// ModelRoundProvider port and a ToolManager-style executeTool callback. Decoupled
// from any client adapter (callers pass a built ModelRoundProvider) and from
// research-specific tool labeling (injected via ToolLabeler).

import { IxplorerError } from "../errors";
import { ToolCallDiagnostic } from "../diagnostics";
import { ChatToolCall, ChatToolDefinition } from "./tool";
import {
  ChatMessage,
  ModelRoundProvider,
  ModelRoundRequest,
  ModelToolOutput,
  ProviderContinuationState,
} from "./protocol";

/** Maps tool calls/results to human-facing labels. Injected so the core loop
 *  carries no knowledge of specific tool names. */
export interface ToolLabeler {
  chainLabel(name: string, args: Record<string, unknown>): string;
  labelFromResult(name: string, result: string): string | undefined;
  resultSummary(name: string, result: string): string | undefined;
}

const DEFAULT_LABELER: ToolLabeler = {
  chainLabel: (name) => name,
  labelFromResult: () => undefined,
  resultSummary: () => undefined,
};

export interface AgentLoopOptions {
  modelRound: ModelRoundProvider;
  model: string;
  messages: ChatMessage[];
  tools: ChatToolDefinition[];
  executeTool(
    toolCall: ChatToolCall,
  ): Promise<{ ok: boolean; result: string; diagnostic?: Record<string, unknown> }>;
  temperature?: number;
  maxTokens?: number;
  maxRounds?: number;
  maxToolCallsPerRound?: number;
  maxTotalResultChars?: number;
  signal?: AbortSignal;
  reasoning?: ModelRoundRequest["reasoning"];
  labeler?: ToolLabeler;
  onEvent?(event: AgentLoopEvent): void;
}

export type AgentLoopEvent =
  | { type: "delta"; content: string }
  | { type: "reasoning"; segmentId: string; content: string }
  | { type: "checkpoint-delta"; checkpointId: string; round: number; content: string }
  | { type: "checkpoint-complete"; checkpointId: string; round: number }
  | { type: "checkpoint-promote"; checkpointId: string; round: number }
  | {
      type: "tool-call-start";
      id: string;
      name: string;
      label: string;
      round: number;
      args?: Record<string, unknown>;
    }
  | {
      type: "tool-call-end";
      id: string;
      ok: boolean;
      resolvedLabel?: string;
      resultSummary?: string;
      resultJson?: string;
    }
  | { type: "answer-reset" }
  | { type: "complete"; content: string };

export interface AgentLoopResult {
  events: AgentLoopEvent[];
  answerText: string;
  diagnostics: ToolCallDiagnostic[];
  reasoningSummaries: string[];
  reasoningItemCount: number;
  continuationRounds: number;
  usage: { inputTokens: number; outputTokens: number; reasoningTokens: number };
}

const DEFAULT_MAX_ROUNDS = 30;
const DEFAULT_MAX_TOOL_CALLS_PER_ROUND = 10;
const DEFAULT_MAX_TOTAL_RESULT_CHARS = 50_000;
const RESULT_PREVIEW_CHARS = 1000;

export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const messages = [...options.messages];
  const events: AgentLoopEvent[] = [];
  const diagnostics: ToolCallDiagnostic[] = [];
  const maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const maxToolCallsPerRound = options.maxToolCallsPerRound ?? DEFAULT_MAX_TOOL_CALLS_PER_ROUND;
  const maxTotalResultChars = options.maxTotalResultChars ?? DEFAULT_MAX_TOTAL_RESULT_CHARS;
  const labeler = options.labeler ?? DEFAULT_LABELER;
  let totalResultChars = 0;
  let answerText = "";
  const reasoningSummaries: string[] = [];
  let reasoningItemCount = 0;
  let continuationRounds = 0;
  const usage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 };
  const modelRound = options.modelRound;
  let continuation: ProviderContinuationState | undefined;
  let toolOutputs: ModelToolOutput[] | undefined;

  try {
    for (let round = 1; round <= maxRounds; round += 1) {
      const roundResult = await collectModelRound({
        modelRound,
        model: options.model,
        messages,
        tools: options.tools,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        signal: options.signal,
        continuation,
        toolOutputs,
        reasoning: options.reasoning,
        round,
        onEvent: options.onEvent,
      });
      continuation = roundResult.continuation;
      reasoningSummaries.push(...roundResult.reasoningSummaries);
      reasoningItemCount += roundResult.reasoningItemCount;
      if (continuation) continuationRounds += 1;
      usage.inputTokens += roundResult.usage.inputTokens;
      usage.outputTokens += roundResult.usage.outputTokens;
      usage.reasoningTokens += roundResult.usage.reasoningTokens;
      toolOutputs = continuation ? [] : undefined;

      answerText = roundResult.content;

      if (roundResult.stopReason === "length" || roundResult.stopReason === "error") {
        throw new IxplorerError({
          code: "MODEL_PROVIDER_UNAVAILABLE",
          details: { reason: `model-round-${roundResult.stopReason}` },
        });
      }

      if (roundResult.toolCalls.length === 0) {
        if (roundResult.streamedText) {
          options.onEvent?.({
            type: "checkpoint-promote",
            checkpointId: `round-${round}`,
            round,
          });
        }
        events.push(...roundResult.events, { type: "complete", content: "" });
        return {
          events,
          answerText,
          diagnostics,
          reasoningSummaries,
          reasoningItemCount,
          continuationRounds,
          usage,
        };
      }

      if (roundResult.streamedText) {
        options.onEvent?.({
          type: "checkpoint-complete",
          checkpointId: `round-${round}`,
          round,
        });
      }

      if (!continuation) {
        messages.push({
          role: "assistant",
          content: roundResult.content,
          toolCalls: roundResult.toolCalls,
        });
      }

      for (const toolCall of roundResult.toolCalls.slice(0, maxToolCallsPerRound)) {
        const remainingChars = maxTotalResultChars - totalResultChars;
        if (remainingChars <= 0) {
          const result = JSON.stringify({ ok: false, reason: "tool-output-budget-exceeded" });
          diagnostics.push({
            id: toolCall.id,
            name: toolCall.name,
            status: "skipped",
            arguments: toolCall.arguments,
            round,
            reason: "tool-output-budget-exceeded",
          });
          appendToolResult(messages, toolOutputs, toolCall.id, result);
          continue;
        }

        const label = labeler.chainLabel(toolCall.name, toolCall.arguments);
        options.onEvent?.({
          type: "tool-call-start",
          id: toolCall.id,
          name: toolCall.name,
          label,
          round,
          args: toolCall.arguments,
        });
        const execution = await options.executeTool(toolCall);
        const result = truncateResult(execution.result, remainingChars);
        const resolvedLabel = labeler.labelFromResult(toolCall.name, result);
        const resultSummary = labeler.resultSummary(toolCall.name, result);
        options.onEvent?.({
          type: "tool-call-end",
          id: toolCall.id,
          ok: execution.ok,
          resolvedLabel,
          resultSummary,
          resultJson: result,
        });
        totalResultChars += result.length;
        diagnostics.push({
          id: toolCall.id,
          name: toolCall.name,
          status: execution.ok ? "success" : "failed",
          arguments: toolCall.arguments,
          resultPreview: result.slice(0, RESULT_PREVIEW_CHARS),
          resultBytes: result.length,
          round,
          reason: result.length < execution.result.length ? "tool-output-truncated" : undefined,
          metadata: execution.diagnostic,
        });
        appendToolResult(messages, toolOutputs, toolCall.id, result);
      }

      if (roundResult.toolCalls.length > maxToolCallsPerRound) {
        for (const toolCall of roundResult.toolCalls.slice(maxToolCallsPerRound)) {
          const result = JSON.stringify({ ok: false, reason: "tool-call-limit-exceeded" });
          diagnostics.push({
            id: toolCall.id,
            name: toolCall.name,
            status: "skipped",
            arguments: toolCall.arguments,
            round,
            reason: "tool-call-limit-exceeded",
          });
          appendToolResult(messages, toolOutputs, toolCall.id, result);
        }
      }
    }
  } finally {
    continuation?.dispose();
  }

  return {
    events: [{ type: "complete", content: "" }],
    answerText,
    diagnostics,
    reasoningSummaries,
    reasoningItemCount,
    continuationRounds,
    usage,
  };
}

async function collectModelRound(options: {
  modelRound: ModelRoundProvider;
  model: string;
  messages: ChatMessage[];
  tools: ChatToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  continuation?: ProviderContinuationState;
  toolOutputs?: ModelToolOutput[];
  reasoning?: ModelRoundRequest["reasoning"];
  round: number;
  onEvent?: AgentLoopOptions["onEvent"];
}): Promise<{
  content: string;
  events: AgentLoopEvent[];
  toolCalls: ChatToolCall[];
  continuation?: ProviderContinuationState;
  reasoningSummaries: string[];
  reasoningItemCount: number;
  usage: { inputTokens: number; outputTokens: number; reasoningTokens: number };
  stopReason: "complete" | "tool_calls" | "length" | "error";
  streamedText: boolean;
}> {
  const events: AgentLoopEvent[] = [];
  const streamedText: string[] = [];
  const streamedSummaries: string[] = [];
  const result = await options.modelRound.runRound({
    model: options.model,
    messages: options.messages,
    tools: options.tools,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    signal: options.signal,
    continuation: options.continuation,
    toolOutputs: options.toolOutputs,
    reasoning: options.reasoning,
    onDelta: (delta) => {
      if (delta.type === "text") {
        streamedText.push(delta.text);
        options.onEvent?.({
          type: "checkpoint-delta",
          checkpointId: `round-${options.round}`,
          round: options.round,
          content: delta.text,
        });
      } else {
        streamedSummaries.push(delta.text);
        options.onEvent?.({
          type: "reasoning",
          segmentId: delta.segmentId
            ? `round-${options.round}-${delta.segmentId}`
            : `reasoning-${options.round}`,
          content: delta.text,
        });
      }
    },
  } satisfies ModelRoundRequest);
  const content = result.items
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("");
  if (streamedText.length > 0) {
    events.push(...streamedText.map((text) => ({ type: "delta" as const, content: text })));
  } else if (content) {
    events.push({ type: "delta", content });
    options.onEvent?.({
      type: "checkpoint-delta",
      checkpointId: `round-${options.round}`,
      round: options.round,
      content,
    });
  }
  const toolCalls = result.items
    .filter((item) => item.type === "toolCall")
    .map((item) => item.call);
  const reasoningSummaries =
    streamedSummaries.length > 0
      ? streamedSummaries
      : result.items.filter((item) => item.type === "reasoningSummary").map((item) => item.text);
  if (streamedSummaries.length === 0) {
    for (let index = 0; index < reasoningSummaries.length; index += 1) {
      options.onEvent?.({
        type: "reasoning",
        segmentId: `reasoning-${options.round}-${index}`,
        content: reasoningSummaries[index],
      });
    }
  }
  return {
    content,
    events,
    toolCalls,
    continuation: result.continuation,
    reasoningSummaries,
    reasoningItemCount: result.reasoningItemCount ?? 0,
    usage: result.usage ?? { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
    stopReason: result.stopReason,
    streamedText: streamedText.length > 0 || content.length > 0,
  };
}

function appendToolResult(
  messages: ChatMessage[],
  toolOutputs: ModelToolOutput[] | undefined,
  callId: string,
  result: string,
): void {
  if (toolOutputs) toolOutputs.push({ callId, output: result });
  else messages.push({ role: "tool", content: result, toolCallId: callId });
}

function truncateResult(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return JSON.stringify({
    ok: false,
    reason: "tool-output-truncated",
    content: value.slice(0, Math.max(0, maxChars - 100)),
  });
}
