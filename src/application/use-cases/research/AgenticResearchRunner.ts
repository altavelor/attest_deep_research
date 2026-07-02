import { ChatMessage, ChatRequest, ModelRoundDelta, ModelRoundProvider, ModelRoundRequest, ModelToolOutput, ProviderContinuationState } from "@core/agent";
import { ChatToolCall, ToolEvent, ToolExecution as ResearchToolExecution, toolExecutionPayload } from "@core/agent";
import { SUB_AGENT_TOOL } from "@core/agent";
import { ReasoningSegmentAttribution, RoundPromptDeltaDiagnostic, ToolCallDiagnostic } from "@core/diagnostics";
import { ResearchExecutionPolicy } from "@core/research";
import { ToolManager } from "@application/tools/ToolManager";
import {
  toolCallChainLabel,
  resolveLabelFromResult,
  resolveResultSummary,
} from "@application/research/toolCallLabel";
import { ConcurrencyLimiter } from "./ToolConcurrencyPool";
import { buildRoundPromptDelta } from "./agenticPromptLog";

export type AgenticFallbackReason =
  | "multiple-mandatory-tools-unresolved"
  | "mandatory-repair-failed"
  | "model-round-limit-exceeded"
  | "tool-result-budget-exceeded"
  | "provider-error"
  | "cancelled"
  | "context-limit-exceeded"
  | "loop-detected";

export interface AgenticResearchRunnerOptions {
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

export type AgenticResearchResult = AgenticResearchSuccess | AgenticResearchFailure;

export interface AgenticResearchSuccess {
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

export interface AgenticResearchFailure {
  ok: false;
  reason: AgenticFallbackReason;
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

interface CachedExecution {
  ok: boolean;
  retryable: boolean;
  result: string;
  diagnostic?: Record<string, unknown>;
}

export class AgenticResearchRunner {
  private readonly modelRound: ModelRoundProvider;

  constructor(private readonly options: AgenticResearchRunnerOptions) {
    this.modelRound = options.modelRound;
  }

  async run(): Promise<AgenticResearchResult> {
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
    // Messages already captured in an earlier round's prompt delta; each round logs
    // only the tail appended since (incremental prompt log).
    let promptLoggedCount = 0;
    const stopReasons: string[] = [];
    let continuation: ProviderContinuationState | undefined;
    let toolOutputs: ModelToolOutput[] | undefined;
    let reasoningItemCount = 0;
    const reasoningSegments: ReasoningSegmentAttribution[] = [];
    let continuationRounds = 0;
    const usage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 };

    const failure = (reason: AgenticFallbackReason): AgenticResearchFailure => ({
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
        const response = await collectRound(
          this.options,
          this.modelRound,
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

        // Pre-launch this round's run_subagent calls up to a bounded concurrency (default
        // 3) instead of the sequential loop below awaiting each one in turn. Calls already
        // in the cache are left alone — the loop below resolves those the normal way — and
        // identical duplicate calls within the same batch share one launch so they don't
        // pay for redundant work.
        const subAgentPool = forceSynthesis
          ? undefined
          : launchSubAgentPool(
              response.toolCalls,
              cache,
              this.options.tools,
              this.options.signal,
              (id, event) => this.options.onToolEvent?.(id, event),
              this.options.maxParallelSubAgents ?? DEFAULT_MAX_PARALLEL_SUB_AGENTS,
            );

        let roundDuplicates = 0;
        let roundHadEvidence = false;
        let roundNewEvidence = false;
        let roundFetchedContent = false;
        let roundAttemptedSearch = false;
        for (const call of response.toolCalls) {
          totalCalls += 1;
          // Already in synthesis mode (budget spent or loop detected): don't spend more
          // tool calls. Still answer every tool call id with a stub so the transcript stays
          // well-formed for the provider.
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
          // Mutation tools are never cached: identical args may have different vault state.
          const bypassCache = mutationTool(call.name);
          const cacheHit = !!execution && !retryMandatory && !bypassCache;
          if (execution && !retryMandatory && !bypassCache) {
            duplicateCalls += 1;
            roundDuplicates += 1;
          } else {
            const pooled = subAgentPool?.get(call.id);
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
          // Over budget: keep this result out of the transcript and switch the loop
          // into synthesis mode. We still emit the tool message (as a stub below) so
          // the provider sees a reply for this call id.
          if (totalResultChars + execution.result.length > maxResultChars) {
            budgetExhausted = true;
          }
          const transcriptResult = budgetExhausted ? SYNTHESIS_TOOL_STUB : execution.result;
          totalResultChars += transcriptResult.length;
          // A fresh content-bearing read (fetch_web_page / read_note) is progress on
          // its own: it pulls full page/note text into the transcript even though it
          // reuses the evidenceId minted at search time. Without this, the normal
          // deep-research pattern — search once, then read several pages — looks like
          // "searched, surfaced no new evidence" and trips loop-detection mid-read.
          if (!cacheHit && execution.ok && contentBearingTool(call.name)) {
            roundFetchedContent = true;
          }
          // A successful keyword search that surfaces no new evidence is a spin signal —
          // including the empty case (resultCount 0), which yields no evidence ids and so
          // would otherwise be invisible to no-progress detection below.
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

        // No-progress detection: a round spins if every call was an exact duplicate, or it
        // searched (keyword search_web/search_index) but surfaced nothing new — including
        // empty results, which carry no evidence id and would otherwise look like a fresh
        // round. Content-bearing reads (fetch_web_page) always count as progress.
        const allDuplicates = roundDuplicates === response.toolCalls.length;
        const searchedWithoutNewEvidence =
          (roundHadEvidence || roundAttemptedSearch) && !roundNewEvidence && !roundFetchedContent;
        if (response.toolCalls.length > 0 && (allDuplicates || searchedWithoutNewEvidence)) {
          consecutiveNoProgressRounds += 1;
        } else {
          consecutiveNoProgressRounds = 0;
        }

        // Stop gathering and synthesize when the result budget is spent or the loop is
        // spinning. Either way the model has evidence in the transcript — far better to let
        // it write the answer than to discard the session for the deterministic fallback.
        // toolChoice is forced to "none" above once forceSynthesis is set.
        if (budgetExhausted || consecutiveNoProgressRounds >= 2) {
          if (missingTools(required, satisfied).length > 0) {
            return failure(budgetExhausted ? "tool-result-budget-exceeded" : "loop-detected");
          }
          forceSynthesis = true;
          if (!synthesisRequested) {
            synthesisRequested = true;
            this.options.onRoundClassified?.(round, "intermediate");
            // In continuation mode the transport is server-side state, not `messages`, so a
            // free user turn would desync — toolChoice "none" + the stub outputs are enough.
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

async function collectRound(
  options: AgenticResearchRunnerOptions,
  modelRound: ModelRoundProvider,
  messages: ChatMessage[],
  toolChoice: ChatRequest["toolChoice"],
  continuation?: ProviderContinuationState,
  toolOutputs?: ModelToolOutput[],
  round = 1,
): Promise<{
  content: string;
  toolCalls: ChatToolCall[];
  continuation?: ProviderContinuationState;
  stopReason: "complete" | "tool_calls" | "length" | "error";
  reasoningItemCount: number;
  reasoningSegments: { segmentId: string; chars: number }[];
  usage: { inputTokens: number; outputTokens: number; reasoningTokens: number };
  streamedText: boolean;
}> {
  let streamedText = false;
  let streamedReasoning = false;
  // segmentId (post-round-prefix) -> accumulated character count, so attribution
  // matches the segmentIds the UI renders.
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
      options.onDelta?.({ type: "reasoningSummary", segmentId, text: summaries[index].text }, round);
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

function serializeExecution(execution: ResearchToolExecution<unknown>): CachedExecution {
  return {
    ok: execution.ok,
    retryable: execution.ok ? false : execution.error.retryable,
    result: JSON.stringify(toolExecutionPayload(execution)),
    ...(execution.diagnostic ? { diagnostic: execution.diagnostic } : {}),
  };
}

function missingTools(required: Set<string>, satisfied: Set<string>): string[] {
  return [...required].filter((name) => !satisfied.has(name));
}

// Pull evidence/chunk identifiers out of a serialized tool result. Regex-based so it
// tolerates truncated or wrapped payloads where JSON.parse would throw.
function extractEvidenceIds(result: string): string[] {
  const ids: string[] = [];
  const pattern = /"(?:evidenceId|chunkId)"\s*:\s*"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(result)) !== null) {
    ids.push(match[1]);
  }
  return ids;
}

function normalizedCallKey(call: Pick<ChatToolCall, "name" | "arguments">): string {
  return `${call.name}:${stableJson(call.arguments)}`;
}

function normalizedDiagnosticKey(diagnostic: ToolCallDiagnostic): string {
  return `${diagnostic.name}:${stableJson(diagnostic.arguments)}`;
}

function stableJson(value: Record<string, unknown>): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, canonicalize(child)]),
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function contentBearingTool(name: string): boolean {
  return name === "read_note" || name === "get_active_note" || name === "fetch_web_page";
}

// Keyword searches whose only job is to surface evidence ids. run_subagent is excluded:
// it returns a synthesized answer (rich even when it lists no parseable evidenceId), so
// counting it as a "fruitless search" would falsely trip loop detection.
function searchTool(name: string): boolean {
  return name === "search_web" || name === "search_index";
}

/**
 * Launches this round's run_subagent calls up to `limit` concurrently instead of
 * leaving them to the sequential per-call loop. Calls already resolved in `cache`
 * are skipped (the loop resolves those itself); identical duplicate calls within
 * the same round share one launch. Returns a map from call id to its in-flight
 * execution promise; the per-call loop awaits the matching entry when present.
 */
function launchSubAgentPool(
  calls: ChatToolCall[],
  cache: Map<string, CachedExecution>,
  tools: ToolManager,
  signal: AbortSignal | undefined,
  onToolEvent: (id: string, event: ToolEvent) => void,
  limit: number,
): Map<string, Promise<ResearchToolExecution<unknown>>> {
  const limiter = new ConcurrencyLimiter(limit);
  const pool = new Map<string, Promise<ResearchToolExecution<unknown>>>();
  const launchedByKey = new Map<string, Promise<ResearchToolExecution<unknown>>>();
  for (const call of calls) {
    if (call.name !== SUB_AGENT_TOOL) continue;
    const key = normalizedCallKey(call);
    if (cache.has(key)) continue;
    const promise =
      launchedByKey.get(key) ??
      limiter.run(() => tools.execute(call, { signal, emit: (event) => onToolEvent(call.id, event) }));
    launchedByKey.set(key, promise);
    pool.set(call.id, promise);
  }
  return pool;
}

function mutationTool(name: string): boolean {
  return name === "create_note" || name === "update_note" || name === "delete_note";
}
