import {
  ChatMessage,
  ChatModelProvider,
  ChatRequest,
  ChatToolCall,
  ModelRoundProvider,
  ModelRoundDelta,
  ModelRoundRequest,
  ModelToolOutput,
  ProviderContinuationState,
  ReasoningSegmentAttribution,
  ToolCallDiagnostic,
} from "../shared/types";
import { ResearchExecutionPolicy } from "./ResearchExecutionPolicy";
import { ResearchToolRegistry } from "./tools/ResearchToolRegistry";
import { researchToolExecutionPayload, ResearchToolExecution } from "./tools/ResearchTools";
import { ChatCompletionsRoundAdapter } from "../client/chat/ChatCompletionsRoundAdapter";
import {
  toolCallChainLabel,
  resolveLabelFromResult,
  resolveResultSummary,
} from "./tools/toolCallLabel";

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
  chatModel: ChatModelProvider;
  modelRound?: ModelRoundProvider;
  model: string;
  messages: ChatMessage[];
  tools: ResearchToolRegistry;
  policy: ResearchExecutionPolicy;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  maxRounds?: number;
  maxResultChars?: number;
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
  stopReasons: string[];
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
  stopReasons: string[];
  totalResultChars: number;
  reasoningItemCount: number;
  reasoningSegments: ReasoningSegmentAttribution[];
  continuationRounds: number;
  usage: { inputTokens: number; outputTokens: number; reasoningTokens: number };
}

// maxRounds is a runaway backstop, not the active limiter; the model decides when
// to stop (coding-loop style). Real control is maxResultChars + loop detection.
const DEFAULT_MAX_ROUNDS = 30;
const DEFAULT_MAX_RESULT_CHARS = 50_000;
const PREVIEW_CHARS = 600;

interface CachedExecution {
  ok: boolean;
  retryable: boolean;
  result: string;
  diagnostic?: Record<string, unknown>;
}

export class AgenticResearchRunner {
  private readonly modelRound: ModelRoundProvider;

  constructor(private readonly options: AgenticResearchRunnerOptions) {
    this.modelRound = options.modelRound ?? new ChatCompletionsRoundAdapter(options.chatModel);
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
    let consecutiveNoProgressRounds = 0;
    const seenEvidenceIds = new Set<string>();
    let rounds = 0;
    const phases: string[] = [];
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
      stopReasons,
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
        const toolChoice: ChatRequest["toolChoice"] =
          phase === "bootstrap"
            ? this.options.policy.bootstrapChoice
            : phase === "repair"
              ? this.options.policy.supportsSpecificChoice
                ? { type: "specific", name: repairTool! }
                : { type: "required" }
              : { type: "auto" };
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
              stopReasons,
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

        let roundDuplicates = 0;
        let roundHadEvidence = false;
        let roundNewEvidence = false;
        for (const call of response.toolCalls) {
          totalCalls += 1;
          const key = normalizedCallKey(call);
          let execution = cache.get(key);
          const retryMandatory =
            phase === "repair" &&
            call.name === repairTool &&
            execution?.ok === false &&
            execution.retryable;
          // Mutation tools are never cached: identical args may have different vault state.
          const bypassCache = mutationTool(call.name);
          const label = toolCallChainLabel(call.name, call.arguments);
          this.options.onToolCall?.(call.id, call.name, label, round, call.arguments);
          if (execution && !retryMandatory && !bypassCache) {
            duplicateCalls += 1;
            roundDuplicates += 1;
          } else {
            const raw = await this.options.tools.execute(call);
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
            return failure("tool-result-budget-exceeded");
          }
          totalResultChars += execution.result.length;
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
            toolOutputs!.push({ callId: call.id, output: execution.result });
          } else {
            messages.push({ role: "tool", content: execution.result, toolCallId: call.id });
          }
        }

        // No-progress detection: a round spins if every call was an exact duplicate,
        // or if it searched for evidence but surfaced nothing new (e.g. the model
        // keeps reformulating the same query against the same low-value chunks).
        const allDuplicates = roundDuplicates === response.toolCalls.length;
        const searchedWithoutNewEvidence = roundHadEvidence && !roundNewEvidence;
        if (response.toolCalls.length > 0 && (allDuplicates || searchedWithoutNewEvidence)) {
          consecutiveNoProgressRounds += 1;
          if (consecutiveNoProgressRounds >= 2) {
            return failure("loop-detected");
          }
        } else {
          consecutiveNoProgressRounds = 0;
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
    result: JSON.stringify(researchToolExecutionPayload(execution)),
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

function mutationTool(name: string): boolean {
  return name === "create_note" || name === "update_note" || name === "delete_note";
}
