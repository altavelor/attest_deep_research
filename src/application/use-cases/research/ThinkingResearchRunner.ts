import {
  ChatMessage,
  ChatRequest,
  ModelRoundDelta,
  ModelRoundProvider,
  ModelToolOutput,
  ProviderContinuationState,
} from "@core/agent";
import type { ModelRoundRequest } from "@core/agent";
import { ToolEvent } from "@core/agent";
import {
  ReasoningSegmentAttribution,
  RoundPromptDeltaDiagnostic,
  ToolCallDiagnostic,
} from "@core/diagnostics";
import { ResearchExecutionPolicy } from "@core/research";
import { ToolManager } from "@application/tools/ToolManager";
import { buildRoundPromptDelta } from "./thinkingPromptLog";
import { collectThinkingModelRound } from "./ThinkingModelRoundCollector";
import { ThinkingToolRoundExecutor } from "./ThinkingToolRoundExecutor";

export type ThinkingFallbackReason =
  | "multiple-mandatory-tools-unresolved"
  | "mandatory-repair-failed"
  | "model-round-limit-exceeded"
  | "tool-result-budget-exceeded"
  | "provider-error"
  | "cancelled"
  | "context-limit-exceeded"
  | "loop-detected";

export interface ThinkingResearchRunnerOptions {
  modelRound: ModelRoundProvider;
  model: string;
  messages: ChatMessage[];
  tools: ToolManager;
  policy: ResearchExecutionPolicy;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  maxRounds?: number;
  maxResultChars?: number;

  maxParallelSubAgents?: number;

  maxParallelToolCalls?: number;
  reasoning?: ModelRoundRequest["reasoning"];
  onDelta?(delta: ModelRoundDelta, round: number): void;
  onAnswerReset?(): void;
  onRoundClassified?(round: number, classification: "intermediate" | "final"): void;
  onToolCall?(
    id: string,
    name: string,
    label: string,
    round: number,
    args?: Record<string, unknown>,
  ): void;
  onToolResult?(
    id: string,
    ok: boolean,
    resolvedLabel?: string,
    resultSummary?: string,
    resultJson?: string,
  ): void;

  onToolEvent?(callId: string, event: ToolEvent): void;
}

export type ThinkingResearchResult = ThinkingResearchSuccess | ThinkingResearchFailure;

export interface ThinkingResearchSuccess {
  ok: true;
  answerText: string;
  diagnostics: ToolCallDiagnostic[];
  satisfiedTools: string[];
  repairedTools: string[];
  rounds: number;
  totalCalls: number;
  duplicateCalls: number;
  phases: string[];
  promptRounds: RoundPromptDeltaDiagnostic[];
  stopReasons: string[];
  maxResultChars: number;
  totalResultChars: number;
  reasoningItemCount: number;
  reasoningSegments: ReasoningSegmentAttribution[];
  continuationRounds: number;
  usage: { inputTokens: number; outputTokens: number; reasoningTokens: number };
}

export interface ThinkingResearchFailure {
  ok: false;
  reason: ThinkingFallbackReason;
  diagnostics: ToolCallDiagnostic[];
  satisfiedTools: string[];
  repairedTools: string[];
  rounds: number;
  totalCalls: number;
  duplicateCalls: number;
  phases: string[];
  promptRounds: RoundPromptDeltaDiagnostic[];
  stopReasons: string[];
  maxResultChars: number;
  totalResultChars: number;
  reasoningItemCount: number;
  reasoningSegments: ReasoningSegmentAttribution[];
  continuationRounds: number;
  usage: { inputTokens: number; outputTokens: number; reasoningTokens: number };
}

const DEFAULT_MAX_ROUNDS = 30;

export const DEFAULT_MAX_RESULT_CHARS = 80_000;

const DEFAULT_MAX_PARALLEL_SUB_AGENTS = 3;

const DEFAULT_MAX_PARALLEL_TOOL_CALLS = 5;

const SYNTHESIS_NUDGE =
  "Stop calling tools and write the final answer now from the evidence already gathered, " +
  "citing sources as instructed. If some sub-question is unverified, state that explicitly " +
  "rather than omitting it.";

export class ThinkingResearchRunner {
  constructor(private readonly options: ThinkingResearchRunnerOptions) {}

  async run(): Promise<ThinkingResearchResult> {
    const messages = this.options.messages.map((message) => ({ ...message }));
    const required = new Set(this.options.policy.requiredTools);
    const satisfied = new Set<string>();
    const repaired = new Set<string>();
    const maxRounds = this.options.maxRounds ?? DEFAULT_MAX_ROUNDS;
    const maxResultChars = this.options.maxResultChars ?? DEFAULT_MAX_RESULT_CHARS;
    const toolExecutor = new ThinkingToolRoundExecutor({
      tools: this.options.tools,
      signal: this.options.signal,
      maxResultChars,
      maxParallelSubAgents: this.options.maxParallelSubAgents ?? DEFAULT_MAX_PARALLEL_SUB_AGENTS,
      maxParallelToolCalls: this.options.maxParallelToolCalls ?? DEFAULT_MAX_PARALLEL_TOOL_CALLS,
      onToolCall: this.options.onToolCall,
      onToolResult: this.options.onToolResult,
      onToolEvent: this.options.onToolEvent,
    });
    let phase: "bootstrap" | "repair" | "research" = "bootstrap";
    let repairTool: string | undefined;
    let forceSynthesis = false;
    let synthesisRequested = false;
    let consecutiveNoProgressRounds = 0;
    let rounds = 0;
    const phases: string[] = [];
    const promptRounds: RoundPromptDeltaDiagnostic[] = [];
    let promptLoggedCount = 0;
    const stopReasons: string[] = [];
    let continuation: ProviderContinuationState | undefined;
    let toolOutputs: ModelToolOutput[] | undefined;
    let reasoningItemCount = 0;
    const reasoningSegments: ReasoningSegmentAttribution[] = [];
    let continuationRounds = 0;
    const usage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 };

    const failure = (reason: ThinkingFallbackReason): ThinkingResearchFailure => ({
      ok: false,
      reason,
      diagnostics: toolExecutor.diagnostics,
      satisfiedTools: [...satisfied],
      repairedTools: [...repaired],
      rounds,
      totalCalls: toolExecutor.totalCalls,
      duplicateCalls: toolExecutor.duplicateCalls,
      phases,
      promptRounds,
      stopReasons,
      maxResultChars,
      totalResultChars: toolExecutor.totalResultChars,
      reasoningItemCount,
      reasoningSegments,
      continuationRounds,
      usage,
    });

    try {
      for (let round = 1; round <= maxRounds; round += 1) {
        rounds = round;
        const roundPhase = phase;
        phases.push(phase);
        if (this.options.signal?.aborted) return failure("cancelled");
        const toolChoice: ChatRequest["toolChoice"] = forceSynthesis
          ? { type: "none" }
          : phase === "bootstrap"
            ? this.options.policy.bootstrapChoice
            : phase === "repair"
              ? this.options.policy.supportsSpecificChoice
                ? { type: "specific", name: repairTool! }
                : { type: "required" }
              : { type: "auto" };
        promptRounds.push(
          buildRoundPromptDelta(round, toolChoice, messages.slice(promptLoggedCount), toolOutputs),
        );
        promptLoggedCount = messages.length;
        const response = await collectThinkingModelRound(
          this.options,
          this.options.modelRound,
          messages,
          toolChoice,
          continuation,
          toolOutputs,
          round,
        );
        continuation = response.continuation;
        reasoningItemCount += response.reasoningItemCount;
        for (const segment of response.reasoningSegments) {
          reasoningSegments.push({
            segmentId: segment.segmentId,
            round,
            phase: roundPhase,
            chars: segment.chars,
          });
        }
        if (continuation) continuationRounds += 1;
        usage.inputTokens += response.usage.inputTokens;
        usage.outputTokens += response.usage.outputTokens;
        usage.reasoningTokens += response.usage.reasoningTokens;
        toolOutputs = undefined;
        stopReasons.push(response.stopReason);
        if (response.stopReason === "length" || response.stopReason === "error") {
          return failure(
            response.stopReason === "length" ? "context-limit-exceeded" : "provider-error",
          );
        }

        if (response.toolCalls.length === 0) {
          const missing = missingTools(required, satisfied);
          if (missing.length === 0 && phase !== "repair") {
            this.options.onRoundClassified?.(round, "final");
            return {
              ok: true,
              answerText: response.content,
              diagnostics: toolExecutor.diagnostics,
              satisfiedTools: [...satisfied],
              repairedTools: [...repaired],
              rounds,
              totalCalls: toolExecutor.totalCalls,
              duplicateCalls: toolExecutor.duplicateCalls,
              phases,
              promptRounds,
              stopReasons,
              maxResultChars,
              totalResultChars: toolExecutor.totalResultChars,
              reasoningItemCount,
              reasoningSegments,
              continuationRounds,
              usage,
            };
          }
          if (phase === "bootstrap" && missing.length === 1) {
            this.options.onRoundClassified?.(round, "intermediate");
            phase = "repair";
            repairTool = missing[0];
            continue;
          }
          return failure(
            missing.length > 1 ? "multiple-mandatory-tools-unresolved" : "mandatory-repair-failed",
          );
        }

        if (response.streamedText) {
          this.options.onRoundClassified?.(round, "intermediate");
        }

        if (!continuation) {
          messages.push({
            role: "assistant",
            content: response.content,
            toolCalls: response.toolCalls,
          });
        }

        const toolRound = await toolExecutor.execute({
          calls: response.toolCalls,
          round,
          phase,
          repairTool,
          requiredTools: required,
          satisfiedTools: satisfied,
          continuation: Boolean(continuation),
          forceSynthesis,
        });
        if (continuation) {
          toolOutputs = toolRound.toolOutputs;
        } else {
          messages.push(...toolRound.toolMessages);
        }

        if (toolRound.noProgress) {
          consecutiveNoProgressRounds += 1;
        } else {
          consecutiveNoProgressRounds = 0;
        }

        if (toolExecutor.isBudgetExhausted || consecutiveNoProgressRounds >= 2) {
          if (missingTools(required, satisfied).length > 0) {
            return failure(
              toolExecutor.isBudgetExhausted ? "tool-result-budget-exceeded" : "loop-detected",
            );
          }
          forceSynthesis = true;
          if (!synthesisRequested) {
            synthesisRequested = true;
            this.options.onRoundClassified?.(round, "intermediate");
            if (!continuation) {
              messages.push({ role: "user", content: SYNTHESIS_NUDGE });
            }
          }
          continue;
        }

        const missing = missingTools(required, satisfied);
        if (phase === "bootstrap") {
          if (missing.length === 0) {
            phase = "research";
          } else if (missing.length === 1) {
            if (toolExecutor.mandatoryFailure(missing[0]) === false) {
              return failure("mandatory-repair-failed");
            }
            phase = "repair";
            repairTool = missing[0];
          } else {
            return failure("multiple-mandatory-tools-unresolved");
          }
        } else if (phase === "repair") {
          if (missing.length > 0) return failure("mandatory-repair-failed");
          repaired.add(repairTool!);
          phase = "research";
        }
      }
      return failure("model-round-limit-exceeded");
    } catch (error) {
      return failure(
        this.options.signal?.aborted || isAbortError(error) ? "cancelled" : "provider-error",
      );
    } finally {
      continuation?.dispose();
    }
  }
}

function missingTools(required: Set<string>, satisfied: Set<string>): string[] {
  return [...required].filter((name) => !satisfied.has(name));
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
