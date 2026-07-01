import { formatCitation } from "../../../../core/retrieval/citations";
import { ResearchAnswer } from "../../../../core/answer";
import { ContextDiagnostics } from "../../../../core/diagnostics";
import { RetrievedChunk, SourceReference } from "../../../../core/model/source";
import { estimateTextTokens, extractFollowUpQuestions } from "../../../../core/research/prompts";
import { buildAgenticResearchMessages } from "../../../../core/research/agenticPrompts";
import { ResearchStreamEvent } from "../../../contracts/research";
import { ToolEvent } from "../../../../core/agent/tool";
import { DEEP_SEARCH_TOOL } from "../../../../core/agent/toolNames";
import {
  DEEP_RESEARCH_PHASE,
  DEEP_RESEARCH_TOOL_END,
  DEEP_RESEARCH_TOOL_START,
} from "../../../research/deepResearchPort";
import { createAsyncEventChannel } from "../../../AsyncEventChannel";
import { AgenticResearchRunner, AgenticResearchFailure } from "../AgenticResearchRunner";
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
import { agenticBudgets, createEmptyContextDiagnostics } from "./ResearchDiagnostics";

interface AgenticRunResult {
  result: Awaited<ReturnType<AgenticResearchRunner["run"]>>;
  answer: ResearchAnswer;
  diagnostics?: ContextDiagnostics;
}

/**
 * Tool-driven research path: lets a capable model gather evidence through a tool
 * loop and produce its own answer. Owns its happy path (status → live deltas →
 * context → complete); on failure it returns control to the dispatcher so a
 * deterministic fallback can still produce a diagnostic report.
 */
export class AgenticResearchStrategy implements ResearchStrategy {
  constructor(private readonly deps: ResearchStrategyDeps) {}

  async *execute(
    ctx: ResearchExecutionContext,
  ): AsyncGenerator<ResearchStreamEvent, ResearchStrategyOutcome> {
    yield { type: "status", message: "Synthesizing answer..." };
    const liveEvents = createAsyncEventChannel<ResearchStreamEvent>();
    const agenticPromise = this.run(ctx, (event) => liveEvents.push(event)).finally(() =>
      liveEvents.close(),
    );
    for await (const event of liveEvents) yield event;
    const agentic = await agenticPromise;
    if (agentic.result.ok) {
      if (agentic.diagnostics) yield { type: "context", diagnostics: agentic.diagnostics };
      yield { type: "complete", answer: agentic.answer };
      return { kind: "completed" };
    }
    if (agentic.result.reason === "cancelled") return { kind: "cancelled" };
    // All non-cancel failures (including provider-error) return to the dispatcher
    // so the deterministic fallback still produces a diagnostic report. Throwing
    // here would surface a generic error with no diagnostics to debug from.
    return {
      kind: "failed",
      failure: agentic.result,
      answer: agentic.answer,
      diagnostics: agentic.diagnostics,
    };
  }

  private async run(
    ctx: ResearchExecutionContext,
    onEvent: (event: ResearchStreamEvent) => void,
  ): Promise<AgenticRunResult> {
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
        graph: {
          enabled: false,
          includeBacklinks: false,
          expandFilteredContextThroughLinks: false,
          depth: 1,
        },
      })
      : undefined;
    // Active note is read upfront and passed as explicit evidence (not via tool loop)
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
      } catch {
        // Silently ignore — active note is optional context
      }
    }

    const created = this.deps.toolsetFactory({
      availability: {
        searchMode,
        noteAccess: this.deps.noteTools !== undefined,
        activeFileAccess:
          this.deps.noteTools !== undefined && request.includeActiveFile === true,
        noteMutationAccess: this.deps.noteTools?.mutationEnabled() === true,
        retrieverAvailable: true,
        webProviderAvailable: this.deps.searchProvider !== undefined,
      },
      noteTools: this.deps.noteTools,
      retriever: this.deps.retriever,
      urlStatusChecker: this.deps.urlStatusChecker,
      indexSourcePaths: request.contextPaths,
      searchProvider: this.deps.searchProvider,
      deepResearchRunner: this.deps.deepResearchRunner,
    });
    // When the user wrote @deep_search, compel at least one deep_search call.
    const effectivePolicy =
      request.forceDeepSearch === true && created.tools.has(DEEP_SEARCH_TOOL)
        ? { ...policy, requiredTools: Object.freeze([...policy.requiredTools, DEEP_SEARCH_TOOL]) }
        : policy;
    const messages = buildAgenticResearchMessages({
      question,
      chatHistory: request.chatHistory,
      requiredTools: effectivePolicy.requiredTools,
      explicitEvidence: [...(assembled?.explicitEvidence ?? []), ...activeNoteEvidence],
      toolContext: {
        coreVariant: searchMode === "none" ? "vault" : "research",
        // Source of truth: exactly the tools the runtime registered for this run.
        availableTools: created.tools.definitions().map((d) => d.function.name),
        indexDescription: indexDescription?.text,
      },
    });
    const estimatedTokens =
      estimateTextTokens(messages.map((message) => message.content).join("\n")) +
      estimateTextTokens(JSON.stringify(created.tools.definitions())) +
      (this.deps.reservedOutputTokens ?? 0);
    const maxResultChars = resolveAgenticMaxResultChars({
      contextLimitTokens: this.deps.contextLimitTokens,
      usedTokens: estimatedTokens,
    });
    let result: Awaited<ReturnType<AgenticResearchRunner["run"]>>;
    if (this.deps.contextLimitTokens && estimatedTokens > this.deps.contextLimitTokens) {
      result = emptyAgenticFailure("context-limit-exceeded", maxResultChars);
    } else {
      result = await new AgenticResearchRunner({
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
          onEvent({ type: "tool-call-start", id, name, label, round, args }),
        onToolResult: (id, ok, resolvedLabel, resultSummary, resultJson) =>
          onEvent({
            type: "tool-call-end",
            id,
            ok,
            resolvedLabel,
            resultSummary,
            resultJson,
          }),
        onToolEvent: (callId, event) => emitNestedDeepResearchEvent(onEvent, callId, event),
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
    const citations = availableCitations.filter((citation) => citedIds.has(citation.id));
    const diagnostics =
      assembled?.diagnostics ??
      createEmptyContextDiagnostics(
        request.contextMode ?? "include",
        result.ok ? "agentic" : "deterministic-fallback",
      );
    diagnostics.executionStrategy = result.ok ? "agentic" : "deterministic-fallback";
    diagnostics.question = question;
    diagnostics.modelName = this.deps.chatModelName;
    diagnostics.modelApiFormat = this.deps.apiFormat;
    diagnostics.searchMode = searchMode;
    if (this.deps.toolCapabilityProbeAudit)
      diagnostics.probeAudit = this.deps.toolCapabilityProbeAudit;
    diagnostics.toolCapabilities = this.deps.toolCapabilities;
    diagnostics.tools = result.diagnostics;
    diagnostics.agentic = {
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
      phases: result.phases,
      reasoningSegments: result.reasoningSegments,
      stopReasons: result.stopReasons,
      budgets: agenticBudgets(result.totalResultChars, result.maxResultChars),
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
 * Maps a deep_search sub-agent's progress (emitted via the tool's `emit`) into
 * nested research-stream events tagged with the parent deep_search call id, so the
 * UI can render the session's live work under its cell. Inner tool-call ids are
 * namespaced by the parent id to stay unique across parallel sessions.
 */
function emitNestedDeepResearchEvent(
  onEvent: (event: ResearchStreamEvent) => void,
  parentId: string,
  event: ToolEvent,
): void {
  const data = event.data ?? {};
  if (event.type === DEEP_RESEARCH_PHASE) {
    onEvent({ type: "deep-research-phase", parentId, phase: event.message ?? "" });
    return;
  }
  if (event.type === DEEP_RESEARCH_TOOL_START) {
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
  if (event.type === DEEP_RESEARCH_TOOL_END) {
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

export function resolveAgenticMaxResultChars(input: {
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

function emptyAgenticFailure(
  reason: AgenticResearchFailure["reason"],
  maxResultChars: number,
): AgenticResearchFailure {
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
    stopReasons: [],
    maxResultChars,
    totalResultChars: 0,
    reasoningItemCount: 0,
    reasoningSegments: [],
    continuationRounds: 0,
    usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
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
