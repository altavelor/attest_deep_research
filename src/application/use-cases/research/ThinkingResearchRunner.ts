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
import {
  toolCallChainLabel,
  resolveLabelFromResult,
  resolveResultSummary,
} from "@application/research/toolCallLabel";
import { buildRoundPromptDelta } from "./thinkingPromptLog";
import {
  CachedExecution,
  contentBearingTool,
  extractEvidenceIds,
  launchParallelToolPool,
  mutationTool,
  normalizedCallKey,
  searchTool,
  serializeExecution,
  stableJson,
} from "./thinkingToolExecution";
import { collectThinkingModelRound } from "./ThinkingModelRoundCollector";

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
  /** Cap on run_subagent calls executed concurrently within one round. */
  maxParallelSubAgents?: number;
  /** Cap on other (read-only) tool calls executed concurrently within one round. */
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
  /** Progress emitted from inside a tool (e.g. a run_subagent session's loop). */
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

// maxRounds is a runaway backstop, not the active limiter; the model decides when
// to stop (coding-loop style). Real control is maxResultChars + loop detection.
const DEFAULT_MAX_ROUNDS = 30;
// Parent tool-result budget. Headroom matters because a single run_subagent answer
// (or several in parallel) lands here as one large tool result; too tight a budget
// trips the fallback before the model can synthesize.
export const DEFAULT_MAX_RESULT_CHARS = 80_000;
const PREVIEW_CHARS = 600;
// How many run_subagent calls within one round may execute concurrently. The rest
// queue and run as a slot frees up (see ConcurrencyLimiter).
const DEFAULT_MAX_PARALLEL_SUB_AGENTS = 3;
// How many other (read-only) tool calls within one round may execute concurrently.
// Sub-agents get their own (smaller) budget above since each spins a nested loop.
const DEFAULT_MAX_PARALLEL_TOOL_CALLS = 5;

// Stub returned in place of a tool result once the loop enters synthesis mode (result
// budget spent or the model is spinning), plus the nudge that asks it to answer from what
// it already gathered. Both conditions mean "stop gathering and answer now" — not "fail and
// hand off to the deterministic fallback", which throws away an otherwise-usable session.
const SYNTHESIS_TOOL_STUB =
  "[omitted: stop calling tools — answer from the evidence already gathered]";
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
    const diagnostics: ToolCallDiagnostic[] = [];
    const cache = new Map<string, CachedExecution>();
    const mandatoryFailures = new Map<string, boolean>();
    const maxRounds = this.options.maxRounds ?? DEFAULT_MAX_ROUNDS;
    const maxResultChars = this.options.maxResultChars ?? DEFAULT_MAX_RESULT_CHARS;
    let phase: "bootstrap" | "repair" | "research" = "bootstrap";
    let repairTool: string | undefined;
    let totalCalls = 0;
    let duplicateCalls = 0;
    let totalResultChars = 0;
    let budgetExhausted = false;
    let forceSynthesis = false;
    let synthesisRequested = false;
    let consecutiveNoProgressRounds = 0;
    const seenEvidenceIds = new Set<string>();
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
      diagnostics,
      satisfiedTools: [...satisfied],
      repairedTools: [...repaired],
      rounds,
      totalCalls,
      duplicateCalls,
      phases,
      promptRounds,
      stopReasons,
      maxResultChars,
      totalResultChars,
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
              diagnostics,
              satisfiedTools: [...satisfied],
              repairedTools: [...repaired],
              rounds,
              totalCalls,
              duplicateCalls,
              phases,
              promptRounds,
              stopReasons,
              maxResultChars,
              totalResultChars,
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
        } else {
          toolOutputs = [];
        }

        if (!forceSynthesis) {
          for (const call of response.toolCalls) {
            const label = toolCallChainLabel(call.name, call.arguments);
            this.options.onToolCall?.(call.id, call.name, label, round, call.arguments);
          }
        }

        const toolPool = forceSynthesis
          ? undefined
          : launchParallelToolPool(
              response.toolCalls,
              cache,
              this.options.tools,
              this.options.signal,
              (id, event) => this.options.onToolEvent?.(id, event),
              this.options.maxParallelSubAgents ?? DEFAULT_MAX_PARALLEL_SUB_AGENTS,
              this.options.maxParallelToolCalls ?? DEFAULT_MAX_PARALLEL_TOOL_CALLS,
            );

        let roundDuplicates = 0;
        let roundHadEvidence = false;
        let roundNewEvidence = false;
        let roundFetchedContent = false;
        let roundAttemptedSearch = false;
        for (const call of response.toolCalls) {
          totalCalls += 1;
          if (forceSynthesis) {
            if (continuation) {
              toolOutputs!.push({ callId: call.id, output: SYNTHESIS_TOOL_STUB });
            } else {
              messages.push({ role: "tool", content: SYNTHESIS_TOOL_STUB, toolCallId: call.id });
            }
            continue;
          }
          const key = normalizedCallKey(call);
          let execution = cache.get(key);
          const retryMandatory =
            phase === "repair" &&
            call.name === repairTool &&
            execution?.ok === false &&
            execution.retryable;
          const bypassCache = mutationTool(call.name);
          const cacheHit = !!execution && !retryMandatory && !bypassCache;
          if (execution && !retryMandatory && !bypassCache) {
            duplicateCalls += 1;
            roundDuplicates += 1;
          } else {
            const pooled = toolPool?.get(call.id);
            const raw = pooled
              ? await pooled
              : await this.options.tools.execute(call, {
                  signal: this.options.signal,
                  emit: (event) => this.options.onToolEvent?.(call.id, event),
                });
            execution = serializeExecution(raw);
            if (!bypassCache) {
              cache.set(key, execution);
            }
          }
          const resolvedLabel = resolveLabelFromResult(call.name, execution.result);
          const resultSummary = resolveResultSummary(call.name, execution.result);
          this.options.onToolResult?.(
            call.id,
            execution.ok,
            resolvedLabel,
            resultSummary,
            execution.result,
          );
          if (totalResultChars + execution.result.length > maxResultChars) {
            budgetExhausted = true;
          }
          const transcriptResult = budgetExhausted ? SYNTHESIS_TOOL_STUB : execution.result;
          totalResultChars += transcriptResult.length;
          if (!cacheHit && execution.ok && contentBearingTool(call.name)) {
            roundFetchedContent = true;
          }
          if (execution.ok && searchTool(call.name)) {
            roundAttemptedSearch = true;
          }
          const evidenceIds = extractEvidenceIds(execution.result);
          if (evidenceIds.length > 0) {
            roundHadEvidence = true;
            for (const id of evidenceIds) {
              if (!seenEvidenceIds.has(id)) {
                roundNewEvidence = true;
                seenEvidenceIds.add(id);
              }
            }
          }
          if (execution.ok && required.has(call.name)) satisfied.add(call.name);
          if (!execution.ok && required.has(call.name)) {
            mandatoryFailures.set(call.name, execution.retryable);
          }
          diagnostics.push({
            id: call.id,
            name: call.name,
            status: execution.ok ? "success" : "failed",
            arguments: call.arguments,
            resultPreview: contentBearingTool(call.name)
              ? "[redacted tool content]"
              : execution.result.slice(0, PREVIEW_CHARS),
            resultBytes: execution.result.length,
            round,
            ...(cache.get(key) === execution &&
            diagnostics.some((item) => normalizedDiagnosticKey(item) === key)
              ? { reason: "duplicate-result-reused" }
              : {}),
            ...(execution.diagnostic ? { metadata: execution.diagnostic } : {}),
          });
          if (continuation) {
            toolOutputs!.push({ callId: call.id, output: transcriptResult });
          } else {
            messages.push({ role: "tool", content: transcriptResult, toolCallId: call.id });
          }
        }

        const allDuplicates = roundDuplicates === response.toolCalls.length;
        const searchedWithoutNewEvidence =
          (roundHadEvidence || roundAttemptedSearch) && !roundNewEvidence && !roundFetchedContent;
        if (response.toolCalls.length > 0 && (allDuplicates || searchedWithoutNewEvidence)) {
          consecutiveNoProgressRounds += 1;
        } else {
          consecutiveNoProgressRounds = 0;
        }

        if (budgetExhausted || consecutiveNoProgressRounds >= 2) {
          if (missingTools(required, satisfied).length > 0) {
            return failure(budgetExhausted ? "tool-result-budget-exceeded" : "loop-detected");
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
            if (mandatoryFailures.get(missing[0]) === false) {
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

function normalizedDiagnosticKey(diagnostic: ToolCallDiagnostic): string {
  return `${diagnostic.name}:${stableJson(diagnostic.arguments)}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
