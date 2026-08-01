import { ChatMessage, ChatToolCall, ModelToolOutput, ToolEvent } from "@core/agent";
import { ToolCallDiagnostic } from "@core/diagnostics";
import { ToolManager } from "@application/tools/ToolManager";
import {
  resolveLabelFromResult,
  resolveResultSummary,
  toolCallChainLabel,
} from "@application/research/toolCallLabel";
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

const PREVIEW_CHARS = 600;
export const SYNTHESIS_TOOL_STUB =
  "[omitted: stop calling tools — answer from the evidence already gathered]";

export interface ThinkingToolRoundExecutorOptions {
  tools: ToolManager;
  signal?: AbortSignal;
  maxResultChars: number;
  maxParallelSubAgents: number;
  maxParallelToolCalls: number;
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

export interface ThinkingToolRoundResult {
  toolMessages: ChatMessage[];
  toolOutputs: ModelToolOutput[];
  noProgress: boolean;
}

/** Executes one round of tool calls while retaining cache, budget, and diagnostics for the run. */
export class ThinkingToolRoundExecutor {
  private readonly cache = new Map<string, CachedExecution>();
  private readonly mandatoryFailures = new Map<string, boolean>();
  private readonly seenEvidenceIds = new Set<string>();
  private readonly callDiagnostics: ToolCallDiagnostic[] = [];
  private totalCallsCount = 0;
  private duplicateCallsCount = 0;
  private totalResultCharsCount = 0;
  private budgetExhausted = false;

  constructor(private readonly options: ThinkingToolRoundExecutorOptions) {}

  get diagnostics(): ToolCallDiagnostic[] {
    return this.callDiagnostics;
  }

  get totalCalls(): number {
    return this.totalCallsCount;
  }

  get duplicateCalls(): number {
    return this.duplicateCallsCount;
  }

  get totalResultChars(): number {
    return this.totalResultCharsCount;
  }

  get isBudgetExhausted(): boolean {
    return this.budgetExhausted;
  }

  mandatoryFailure(name: string): boolean | undefined {
    return this.mandatoryFailures.get(name);
  }

  async execute(options: {
    calls: ChatToolCall[];
    round: number;
    phase: "bootstrap" | "repair" | "research";
    repairTool?: string;
    requiredTools: Set<string>;
    satisfiedTools: Set<string>;
    continuation: boolean;
    forceSynthesis: boolean;
  }): Promise<ThinkingToolRoundResult> {
    const toolMessages: ChatMessage[] = [];
    const toolOutputs: ModelToolOutput[] = [];
    if (options.forceSynthesis) {
      for (const call of options.calls) {
        this.totalCallsCount += 1;
        this.appendToolResult(
          call.id,
          SYNTHESIS_TOOL_STUB,
          options.continuation,
          toolMessages,
          toolOutputs,
        );
      }
      return { toolMessages, toolOutputs, noProgress: false };
    }

    for (const call of options.calls) {
      const label = toolCallChainLabel(call.name, call.arguments);
      this.options.onToolCall?.(call.id, call.name, label, options.round, call.arguments);
    }
    const toolPool = launchParallelToolPool(
      options.calls,
      this.cache,
      this.options.tools,
      this.options.signal,
      (id, event) => this.options.onToolEvent?.(id, event),
      this.options.maxParallelSubAgents,
      this.options.maxParallelToolCalls,
    );

    let roundDuplicates = 0;
    let roundHadEvidence = false;
    let roundNewEvidence = false;
    let roundFetchedContent = false;
    let roundAttemptedSearch = false;
    for (const call of options.calls) {
      this.totalCallsCount += 1;
      const key = normalizedCallKey(call);
      const cachedExecution = this.cache.get(key);
      const retryMandatory =
        options.phase === "repair" &&
        call.name === options.repairTool &&
        cachedExecution?.ok === false &&
        cachedExecution.retryable;
      const bypassCache = mutationTool(call.name);
      const cacheHit = !!cachedExecution && !retryMandatory && !bypassCache;
      let execution: CachedExecution;
      if (cacheHit) {
        execution = cachedExecution;
        this.duplicateCallsCount += 1;
        roundDuplicates += 1;
      } else {
        const pooled = toolPool.get(call.id);
        const raw = pooled
          ? await pooled
          : await this.options.tools.execute(call, {
              signal: this.options.signal,
              emit: (event) => this.options.onToolEvent?.(call.id, event),
            });
        execution = serializeExecution(raw);
        if (!bypassCache) {
          this.cache.set(key, execution);
        }
      }

      this.recordExecution({
        call,
        execution,
        round: options.round,
        requiredTools: options.requiredTools,
        satisfiedTools: options.satisfiedTools,
      });
      if (this.totalResultCharsCount + execution.result.length > this.options.maxResultChars) {
        this.budgetExhausted = true;
      }
      const transcriptResult = this.budgetExhausted ? SYNTHESIS_TOOL_STUB : execution.result;
      this.totalResultCharsCount += transcriptResult.length;
      this.appendToolResult(
        call.id,
        transcriptResult,
        options.continuation,
        toolMessages,
        toolOutputs,
      );

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
          if (!this.seenEvidenceIds.has(id)) {
            roundNewEvidence = true;
            this.seenEvidenceIds.add(id);
          }
        }
      }
    }

    const allDuplicates = roundDuplicates === options.calls.length;
    const searchedWithoutNewEvidence =
      (roundHadEvidence || roundAttemptedSearch) && !roundNewEvidence && !roundFetchedContent;
    return {
      toolMessages,
      toolOutputs,
      noProgress: options.calls.length > 0 && (allDuplicates || searchedWithoutNewEvidence),
    };
  }

  private recordExecution(options: {
    call: ChatToolCall;
    execution: CachedExecution;
    round: number;
    requiredTools: Set<string>;
    satisfiedTools: Set<string>;
  }): void {
    const { call, execution } = options;
    const resolvedLabel = resolveLabelFromResult(call.name, execution.result);
    const resultSummary = resolveResultSummary(call.name, execution.result);
    this.options.onToolResult?.(
      call.id,
      execution.ok,
      resolvedLabel,
      resultSummary,
      execution.result,
    );
    if (execution.ok && options.requiredTools.has(call.name)) {
      options.satisfiedTools.add(call.name);
    }
    if (!execution.ok && options.requiredTools.has(call.name)) {
      this.mandatoryFailures.set(call.name, execution.retryable);
    }
    const key = normalizedCallKey(call);
    this.callDiagnostics.push({
      id: call.id,
      name: call.name,
      status: execution.ok ? "success" : "failed",
      arguments: call.arguments,
      resultPreview: contentBearingTool(call.name)
        ? "[redacted tool content]"
        : execution.result.slice(0, PREVIEW_CHARS),
      resultBytes: execution.result.length,
      round: options.round,
      ...(this.cache.get(key) === execution &&
      this.callDiagnostics.some((item) => normalizedDiagnosticKey(item) === key)
        ? { reason: "duplicate-result-reused" }
        : {}),
      ...(execution.diagnostic ? { metadata: execution.diagnostic } : {}),
    });
  }

  private appendToolResult(
    callId: string,
    content: string,
    continuation: boolean,
    toolMessages: ChatMessage[],
    toolOutputs: ModelToolOutput[],
  ): void {
    if (continuation) {
      toolOutputs.push({ callId, output: content });
    } else {
      toolMessages.push({ role: "tool", content, toolCallId: callId });
    }
  }
}

function normalizedDiagnosticKey(diagnostic: ToolCallDiagnostic): string {
  return `${diagnostic.name}:${stableJson(diagnostic.arguments)}`;
}
