import { formatCitation } from "@core/retrieval";
import { ResearchAnswer } from "@core/answer";
import { ContextDiagnostics } from "@core/diagnostics";
import { RetrievedChunk, SourceReference } from "@core/model";
import { estimateTextTokens, extractFollowUpQuestions } from "@core/research";
import { buildThinkingResearchMessages } from "@core/research";
import { isWebQueryIntent, isWebQueryRecency } from "@core/web";
import { ResearchStreamEvent } from "@application/contracts/research";
import type { WebSearchOptions } from "@application/ports";
import { ToolEvent } from "@core/agent";
import { SUB_AGENT_TOOL } from "@core/agent";
import {
  SUB_AGENT_PHASE,
  SUB_AGENT_TOOL_END,
  SUB_AGENT_TOOL_START,
} from "@application/research/subAgentPort";
import { createAsyncEventChannel } from "@application/AsyncEventChannel";
import { ThinkingResearchRunner, ThinkingResearchFailure } from "../ThinkingResearchRunner";
import {
  ResearchExecutionContext,
  ResearchStrategy,
  ResearchStrategyDeps,
  ResearchStrategyOutcome,
} from "./ResearchStrategy";
import {
  dedupeEvidence,
  mergeCitations,
  resolveCitationTokens,
  webUrlEvidenceIndex,
} from "./citations";
import { verifyCitations } from "./citationVerification";
import {
  thinkingBudgets,
  createEmptyContextDiagnostics,
  semanticDegradationWarning,
} from "./ResearchDiagnostics";

interface ThinkingRunResult {
  result: Awaited<ReturnType<ThinkingResearchRunner["run"]>>;
  answer: ResearchAnswer;
  diagnostics?: ContextDiagnostics;
}

/**
 * Tool-driven research path: lets a capable model gather evidence through a tool
 * loop and produce its own answer. Owns its happy path (status → live deltas →
 * context → complete); on failure it returns control to the dispatcher so a
 * deterministic fallback can still produce a diagnostic report.
 */
export class ThinkingResearchStrategy implements ResearchStrategy {
  constructor(private readonly deps: ResearchStrategyDeps) {}

  async *execute(
    ctx: ResearchExecutionContext,
  ): AsyncGenerator<ResearchStreamEvent, ResearchStrategyOutcome> {
    yield { type: "status", message: "Synthesizing answer..." };
    const liveEvents = createAsyncEventChannel<ResearchStreamEvent>();
    const thinkingPromise = this.run(ctx, (event) => liveEvents.push(event)).finally(() =>
      liveEvents.close(),
    );
    for await (const event of liveEvents) yield event;
    const thinking = await thinkingPromise;
    if (thinking.result.ok) {
      if (thinking.diagnostics) yield { type: "context", diagnostics: thinking.diagnostics };
      yield { type: "complete", answer: thinking.answer };
      return { kind: "completed" };
    }
    if (thinking.result.reason === "cancelled") return { kind: "cancelled" };
    return {
      kind: "failed",
      failure: thinking.result,
      answer: thinking.answer,
      diagnostics: thinking.diagnostics,
    };
  }

  private async run(
    ctx: ResearchExecutionContext,
    onEvent: (event: ResearchStreamEvent) => void,
  ): Promise<ThinkingRunResult> {
    const { request, question, searchMode, policy, indexDescription } = ctx;
    const assembled = this.deps.contextAssembler
      ? await this.deps.contextAssembler.assemble({
          question,
          contextMode: request.contextMode ?? "include",
          contextPaths: request.contextPaths ?? [],
          includeActiveFile: false,
          chatHistory: request.chatHistory,
          contextLimitTokens: this.deps.contextLimitTokens,
          reservedOutputTokens: this.deps.reservedOutputTokens,
          evidenceLimit: this.deps.evidenceLimit,
          skipRetrieval: true,
          largeAttachmentsAsReferences: this.deps.noteTools !== undefined,
          graph: {
            enabled: false,
            includeBacklinks: false,
            expandFilteredContextThroughLinks: false,
            depth: 1,
          },
        })
      : undefined;
    let activeNoteEvidence: RetrievedChunk[] = [];
    if (request.includeActiveFile && request.activeFilePath && this.deps.noteTools) {
      try {
        const activeResult = await this.deps.noteTools.execute({
          id: "active-note-prefetch",
          name: "get_active_note",
          arguments: {},
        });
        if (activeResult.ok) {
          const parsed = JSON.parse(activeResult.result) as unknown;
          if (isChunkList(parsed)) {
            activeNoteEvidence = parsed.chunks.map((chunk) => ({
              id: chunk.id,
              text: chunk.text,
              score: 1,
              contentHash: chunk.id,
              source: chunk.evidenceSource,
            }));
          }
        }
      } catch {}
    }

    const created = this.deps.toolsetFactory({
      availability: {
        searchMode,
        noteAccess: this.deps.noteTools !== undefined,
        activeFileAccess: this.deps.noteTools !== undefined && request.includeActiveFile === true,
        noteMutationAccess: this.deps.noteTools?.mutationEnabled() === true,
        retrieverAvailable: true,
        webProviderAvailable: this.deps.searchProvider !== undefined,
      },
      noteTools: this.deps.noteTools,
      retriever: this.deps.retriever,
      urlStatusChecker: this.deps.urlStatusChecker,
      indexSourcePaths: request.contextPaths,
      searchProvider: this.deps.searchProvider,
      ...(this.deps.imageSearch ? { imageSearch: this.deps.imageSearch } : {}),
      ...(this.deps.documentImageCandidates
        ? {
            documentImageCandidates: () =>
              this.deps.documentImageCandidates!(request.contextPaths ?? []),
          }
        : {}),
      subAgentRunner: this.deps.subAgentRunner,
      vaultWriter: this.deps.vaultWriter,
      downloadFolder: this.deps.downloadFolder,
    });
    const effectivePolicy =
      request.forceSubAgent === true && created.tools.has(SUB_AGENT_TOOL)
        ? { ...policy, requiredTools: Object.freeze([...policy.requiredTools, SUB_AGENT_TOOL]) }
        : policy;
    const messages = buildThinkingResearchMessages({
      question,
      chatHistory: request.chatHistory,
      requiredTools: effectivePolicy.requiredTools,
      explicitEvidence: [...(assembled?.explicitEvidence ?? []), ...activeNoteEvidence],
      attachedFiles: assembled?.attachments,
      toolContext: {
        coreVariant: searchMode === "none" ? "vault" : "research",
        availableTools: created.tools.definitions().map((d) => d.function.name),
        indexDescription: indexDescription?.text,
      },
    });
    const estimatedTokens =
      estimateTextTokens(messages.map((message) => message.content).join("\n")) +
      estimateTextTokens(JSON.stringify(created.tools.definitions())) +
      (this.deps.reservedOutputTokens ?? 0);
    const maxResultChars = resolveThinkingMaxResultChars({
      contextLimitTokens: this.deps.contextLimitTokens,
      usedTokens: estimatedTokens,
    });
    let result: Awaited<ReturnType<ThinkingResearchRunner["run"]>>;
    if (this.deps.contextLimitTokens && estimatedTokens > this.deps.contextLimitTokens) {
      result = emptyThinkingFailure("context-limit-exceeded", maxResultChars);
    } else {
      result = await new ThinkingResearchRunner({
        modelRound: this.deps.modelRound ?? this.deps.modelRoundFactory(this.deps.chatModel),
        model: this.deps.chatModelName,
        messages,
        tools: created.tools,
        policy: effectivePolicy,
        maxResultChars,
        temperature: this.deps.chatOptions.temperature,
        maxTokens: this.deps.chatOptions.maxTokens,
        reasoning: this.deps.reasoning,
        signal: request.signal,
        onDelta: (delta, round) => {
          if (delta.type === "text") {
            onEvent({
              type: "checkpoint-delta",
              checkpointId: `round-${round}`,
              round,
              content: delta.text,
            });
          } else {
            onEvent({
              type: "reasoning",
              segmentId: delta.segmentId ?? `reasoning-${round}`,
              content: delta.text,
            });
          }
        },
        onRoundClassified: (round, classification) =>
          onEvent({
            type: classification === "final" ? "checkpoint-promote" : "checkpoint-complete",
            checkpointId: `round-${round}`,
            round,
          }),
        onToolCall: (id, name, label, round, args) =>
          onEvent({
            type: "tool-call-start",
            id,
            name,
            label,
            round,
            args,
            ...(name === "fetch_web_page"
              ? { fetchTargets: resolveFetchTargets(args, created.evidence) }
              : {}),
            ...(name === "search_web"
              ? { searchSources: resolveSearchSources(args, this.deps.searchProvider) }
              : {}),
          }),
        onToolResult: (id, ok, resolvedLabel, resultSummary, resultJson) =>
          onEvent({
            type: "tool-call-end",
            id,
            ok,
            resolvedLabel,
            resultSummary,
            resultJson,
          }),
        onToolEvent: (callId, event) => emitNestedSubAgentEvent(onEvent, callId, event),
      }).run();
    }
    const snapshot = created.evidence.snapshot();
    const explicitEvidence = assembled?.explicitEvidence ?? [];
    const evidence = dedupeEvidence([...explicitEvidence, ...snapshot.evidence]);
    const availableCitations = mergeCitations(
      explicitEvidence.map((chunk) => ({ ...formatCitation(chunk.source), id: chunk.id })),
      [...snapshot.citations],
    );
    const urlToEvidenceId = webUrlEvidenceIndex(evidence);
    const { ids: citedIds, unresolvedUrls } = result.ok
      ? resolveCitationTokens(result.answerText, urlToEvidenceId)
      : { ids: new Set<string>(), unresolvedUrls: [] };
    const knownIds = new Set(evidence.map((chunk) => chunk.id));
    const unknownCitationIds = [
      ...[...citedIds].filter((id) => !knownIds.has(id)),
      ...unresolvedUrls,
    ];
    const unverifiedCitations = result.ok
      ? verifyCitations(result.answerText, evidence, { urlToEvidenceId })
      : [];
    const citations = availableCitations.filter((citation) => citedIds.has(citation.id));
    const diagnostics =
      assembled?.diagnostics ??
      createEmptyContextDiagnostics(
        request.contextMode ?? "include",
        result.ok ? "thinking" : "instant-fallback",
      );
    diagnostics.executionStrategy = result.ok ? "thinking" : "instant-fallback";
    diagnostics.question = question;
    diagnostics.modelName = this.deps.chatModelName;
    diagnostics.modelApiFormat = this.deps.apiFormat;
    diagnostics.searchMode = searchMode;
    if (this.deps.toolCapabilityProbeAudit)
      diagnostics.probeAudit = this.deps.toolCapabilityProbeAudit;
    diagnostics.toolCapabilities = this.deps.toolCapabilities;
    diagnostics.tools = result.diagnostics;
    const degradation = semanticDegradationWarning(
      result.diagnostics.map((tool) => ({
        semanticError:
          typeof tool.metadata?.semanticError === "string"
            ? tool.metadata.semanticError
            : undefined,
      })),
    );
    if (degradation && !diagnostics.warnings.includes(degradation)) {
      diagnostics.warnings.push(degradation);
    }
    if (unverifiedCitations.length > 0) {
      const warning =
        `${unverifiedCitations.length} citation(s) could not be verified against the cited ` +
        "source text — the claim may be misattributed. Re-read the source before relying on it.";
      if (!diagnostics.warnings.includes(warning)) {
        diagnostics.warnings.push(warning);
      }
    }
    diagnostics.thinking = {
      policyReason: policy.reason,
      requiredTools: [...effectivePolicy.requiredTools],
      bootstrapChoice: policy.bootstrapChoice,
      satisfiedTools: result.satisfiedTools,
      repairedTools: result.repairedTools,
      rounds: result.rounds,
      totalCalls: result.totalCalls,
      duplicateCalls: result.duplicateCalls,
      ...(!result.ok ? { fallbackReason: result.reason } : {}),
      duplicatedCost: !result.ok,
      capabilityProvenance: this.deps.toolCapabilityProvenance,
      ...(unknownCitationIds.length > 0 ? { unknownCitationIds } : {}),
      ...(unverifiedCitations.length > 0 ? { unverifiedCitations } : {}),
      phases: result.phases,
      promptDeltas: result.promptRounds,
      reasoningSegments: result.reasoningSegments,
      stopReasons: result.stopReasons,
      budgets: thinkingBudgets(result.totalResultChars, result.maxResultChars),
    };
    if (this.deps.reasoningDiagnostics) {
      diagnostics.reasoning = {
        ...this.deps.reasoningDiagnostics,
        ...(this.deps.reasoning?.effort ? { configuredEffort: this.deps.reasoning.effort } : {}),
        summaryRequested: this.deps.reasoning?.summary === "auto",
        reasoningItemCount: result.reasoningItemCount,
        continuationRounds: result.continuationRounds,
        ...result.usage,
      };
    }
    if (indexDescription) diagnostics.indexDescription = { ...indexDescription.diagnostics };
    const answer: ResearchAnswer = {
      question,
      answer: result.ok ? result.answerText : "",
      citations,
      evidence,
      ...(request.includeContextDiagnostics === true ? { contextDiagnostics: diagnostics } : {}),
      followUpQuestions: result.ok ? extractFollowUpQuestions(result.answerText) : [],
      ...(result.ok && created.artifacts.snapshot()
        ? { artifacts: created.artifacts.snapshot()! }
        : {}),
      createdAt: this.deps.now().toISOString(),
    };
    if (result.ok && this.deps.persistFinalAnswer) await this.deps.persistFinalAnswer(answer);
    return {
      result,
      answer,
      diagnostics: request.includeContextDiagnostics ? diagnostics : undefined,
    };
  }
}

/**
 * Maps a run_subagent session's progress (emitted via the tool's `emit`) into
 * nested research-stream events tagged with the parent run_subagent call id, so
 * the UI can render the session's live work under its cell. Inner tool-call ids
 * are namespaced by the parent id to stay unique across parallel sessions.
 */
function emitNestedSubAgentEvent(
  onEvent: (event: ResearchStreamEvent) => void,
  parentId: string,
  event: ToolEvent,
): void {
  const data = event.data ?? {};
  if (event.type === SUB_AGENT_PHASE) {
    onEvent({ type: "sub-agent-phase", parentId, phase: event.message ?? "" });
    return;
  }
  if (event.type === SUB_AGENT_TOOL_START) {
    onEvent({
      type: "tool-call-start",
      parentId,
      id: `${parentId}:${String(data.id ?? "")}`,
      name: String(data.name ?? ""),
      label: String(data.label ?? data.name ?? ""),
      round: typeof data.round === "number" ? data.round : 0,
    });
    return;
  }
  if (event.type === SUB_AGENT_TOOL_END) {
    onEvent({
      type: "tool-call-end",
      parentId,
      id: `${parentId}:${String(data.id ?? "")}`,
      ok: data.ok === true,
      resolvedLabel: typeof data.resolvedLabel === "string" ? data.resolvedLabel : undefined,
      resultSummary: typeof data.resultSummary === "string" ? data.resultSummary : undefined,
    });
  }
}

export function resolveThinkingMaxResultChars(input: {
  contextLimitTokens?: number;
  usedTokens: number;
}): number {
  const fallback = 80_000;
  if (!input.contextLimitTokens || input.contextLimitTokens <= 0) {
    return fallback;
  }

  const availableTokens = Math.max(0, input.contextLimitTokens - input.usedTokens);
  const targetChars = Math.floor(availableTokens * 4 * 0.25);
  return Math.max(fallback, Math.min(1_000_000, targetChars));
}

function emptyThinkingFailure(
  reason: ThinkingResearchFailure["reason"],
  maxResultChars: number,
): ThinkingResearchFailure {
  return {
    ok: false,
    reason,
    diagnostics: [],
    satisfiedTools: [],
    repairedTools: [],
    rounds: 0,
    totalCalls: 0,
    duplicateCalls: 0,
    phases: [],
    promptRounds: [],
    stopReasons: [],
    maxResultChars,
    totalResultChars: 0,
    reasoningItemCount: 0,
    reasoningSegments: [],
    continuationRounds: 0,
    usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
  };
}

function resolveFetchTargets(
  args: Record<string, unknown> | undefined,
  evidence: { resolveWebResult?(resultId: string): { canonicalUrl: string } | undefined },
): string[] {
  if (!Array.isArray(args?.resultIds) || !evidence.resolveWebResult) return [];
  const sites = new Set<string>();
  for (const resultId of args.resultIds) {
    if (typeof resultId !== "string") continue;
    const entry = evidence.resolveWebResult(resultId);
    if (!entry) continue;
    try {
      sites.add(new URL(entry.canonicalUrl).hostname);
    } catch {
      sites.add(entry.canonicalUrl);
    }
  }
  return [...sites];
}

function resolveSearchSources(
  args: Record<string, unknown> | undefined,
  provider:
    | { searchSourceLabels?(query: string, options?: WebSearchOptions): readonly string[] }
    | undefined,
): string[] {
  const query = typeof args?.query === "string" ? args.query.trim() : "";
  return query && provider?.searchSourceLabels
    ? [...provider.searchSourceLabels(query, searchSourceOptions(args))]
    : [];
}

function searchSourceOptions(args: Record<string, unknown> | undefined): WebSearchOptions {
  return {
    ...(isWebQueryIntent(args?.category) ? { intent: args.category } : {}),
    ...(isWebQueryRecency(args?.recency) ? { recency: args.recency } : {}),
  };
}

function isChunkList(value: unknown): value is {
  chunks: Array<{
    id: string;
    text: string;
    evidenceSource: SourceReference;
  }>;
} {
  if (typeof value !== "object" || value === null) return false;
  const chunks = (value as Record<string, unknown>).chunks;
  return (
    Array.isArray(chunks) &&
    chunks.every(
      (c) =>
        typeof c === "object" &&
        c !== null &&
        typeof (c as Record<string, unknown>).id === "string" &&
        typeof (c as Record<string, unknown>).text === "string",
    )
  );
}
