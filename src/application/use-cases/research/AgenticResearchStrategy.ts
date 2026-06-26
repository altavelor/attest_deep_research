import { formatCitation } from "../../../core/retrieval/citations";
import { ResearchAnswer } from "../../../core/answer";
import { ContextDiagnostics } from "../../../core/diagnostics";
import { RetrievedChunk, SourceReference } from "../../../core/model/source";
import { estimateTextTokens, extractFollowUpQuestions } from "../../../core/research/prompts";
import { buildAgenticResearchMessages } from "../../../core/research/agenticPrompts";
import { ResearchStreamEvent } from "../../contracts/research";
import { createAsyncEventChannel } from "../../AsyncEventChannel";
import { AgenticResearchRunner, AgenticResearchFailure } from "../AgenticResearchRunner";
import {
  ResearchExecutionContext,
  ResearchStrategy,
  ResearchStrategyDeps,
  ResearchStrategyOutcome,
} from "./ResearchStrategy";
import { citationIdsFromText, dedupeEvidence, mergeCitations } from "./citations";
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
      searchProvider: this.deps.searchProvider,
    });
    const messages = buildAgenticResearchMessages({
      question,
      chatHistory: request.chatHistory,
      requiredTools: policy.requiredTools,
      explicitEvidence: [...(assembled?.explicitEvidence ?? []), ...activeNoteEvidence],
      activeSkills: {
        coreVariant: searchMode === "none" ? "vault" : "research",
        index: searchMode === "indexOnly" || searchMode === "indexAndWeb",
        web: searchMode === "webOnly" || searchMode === "indexAndWeb",
        indexDescription: indexDescription?.text,
        noteMutationAccess: this.deps.noteTools?.mutationEnabled() === true,
      },
    });
    const estimatedTokens =
      estimateTextTokens(messages.map((message) => message.content).join("\n")) +
      estimateTextTokens(JSON.stringify(created.tools.definitions())) +
      (this.deps.reservedOutputTokens ?? 0);
    let result: Awaited<ReturnType<AgenticResearchRunner["run"]>>;
    if (this.deps.contextLimitTokens && estimatedTokens > this.deps.contextLimitTokens) {
      result = emptyAgenticFailure("context-limit-exceeded");
    } else {
      result = await new AgenticResearchRunner({
        modelRound: this.deps.modelRound ?? this.deps.modelRoundFactory(this.deps.chatModel),
        model: this.deps.chatModelName,
        messages,
        tools: created.tools,
        policy,
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
      }).run();
    }
    const snapshot = created.evidence.snapshot();
    const explicitEvidence = assembled?.explicitEvidence ?? [];
    const evidence = dedupeEvidence([...explicitEvidence, ...snapshot.evidence]);
    const availableCitations = mergeCitations(
      explicitEvidence.map((chunk) => ({ ...formatCitation(chunk.source), id: chunk.id })),
      [...snapshot.citations],
    );
    const citedIds = result.ok ? citationIdsFromText(result.answerText) : new Set<string>();
    const knownIds = new Set(evidence.map((chunk) => chunk.id));
    const unknownCitationIds = [...citedIds].filter((id) => !knownIds.has(id));
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
      requiredTools: [...policy.requiredTools],
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
      budgets: agenticBudgets(result.totalResultChars),
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

function emptyAgenticFailure(reason: AgenticResearchFailure["reason"]): AgenticResearchFailure {
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
