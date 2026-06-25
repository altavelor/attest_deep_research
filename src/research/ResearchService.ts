import { RetrievalResult } from "../application/contracts/retrieval";
import { formatCitation } from "../retrieval/citations";
import { QueryExpansionService } from "../retrieval/QueryExpansionService";
import { summarizeCompactionWithModel } from "../chat/ChatCompaction";
import {
  ChatModelProvider,
  ChatRequest,
  Citation,
  ContextDiagnostics,
  ContextMode,
  ResearchExecutionStrategy,
  ContextIndexDiagnostics,
  ResearchAnswer,
  RetrievedChunk,
  SearchProvider,
  WebContextDiagnostics,
  IndexDescriptionPromptContext,
  ToolCallingCapabilities,
  ToolCapabilityProbeAudit,
  ApiFormat,
  ModelRoundProvider,
} from "../shared/types";
import { AnswerSynthesisService, AnswerSynthesisServiceOptions } from "./AnswerSynthesisService";
import { ContextAssembler, ContextAssembleRequest } from "./ContextAssembler";
import { EvidencePlanner, EvidencePlannerOptions } from "./EvidencePlanner";
import { NoteToolService } from "./tools/NoteTools";
import { VaultResearchPipeline } from "./VaultResearchPipeline";
import { WebResearchPipeline } from "./WebResearchPipeline";
import {
  ResearchRequest,
  ResearchRetriever,
  ResearchSearchMode,
  ResearchStreamEvent,
} from "./types";
import { ChatDisplayMessage, ConversationCompactionSummary } from "../core/conversation";
import { estimateTextTokens } from "./prompts";
import { resolveResearchExecutionPolicy } from "./ResearchExecutionPolicy";
import { createResearchToolRegistry } from "./tools/createResearchToolRegistry";
import { AgenticResearchRunner, AgenticResearchFailure } from "./AgenticResearchRunner";
import { buildAgenticResearchMessages } from "./agenticPrompts";
import { extractFollowUpQuestions } from "./prompts";
import { createAsyncEventChannel } from "../shared/AsyncEventChannel";

export type { ResearchRequest, ResearchRetriever, ResearchSearchMode, ResearchStreamEvent };

export interface ResearchServiceOptions {
  retriever: ResearchRetriever;
  chatModel: ChatModelProvider;
  chatModelName: string;
  chatOptions?: Pick<ChatRequest, "temperature" | "maxTokens">;
  searchProvider?: SearchProvider;
  queryExpansion?: QueryExpansionService;
  contextAssembler?: ContextAssembler;
  graphContext?: ContextAssembleRequest["graph"];
  evidenceLimit?: number;
  evidencePlanner?: EvidencePlannerOptions;
  contextLimitTokens?: number;
  temperature?: number;
  now?: () => Date;
  persistFinalAnswer?: (answer: ResearchAnswer) => void | Promise<void>;
  noteTools?: NoteToolService;
  toolsEnabled?: boolean;
  getIndexStatus?: () => ContextIndexDiagnostics;
  forceEagerResearch?: boolean;
  indexDescription?: IndexDescriptionPromptContext;
  toolCapabilities?: ToolCallingCapabilities;
  toolCapabilityProvenance?: Record<string, string>;
  toolCapabilityProbeAudit?: ToolCapabilityProbeAudit;
  apiFormat?: ApiFormat;
  modelRound?: ModelRoundProvider;
  reasoning?: { enabled: boolean; effort?: string; summary: "off" | "auto" };
  reasoningDiagnostics?: AnswerSynthesisServiceOptions["reasoningDiagnostics"];
}

const DEFAULT_EVIDENCE_LIMIT = 8;
const DEFAULT_TEMPERATURE = 0.2;
export class ResearchService {
  private readonly vaultPipeline: VaultResearchPipeline;
  private readonly webPipeline: WebResearchPipeline;
  private readonly answerSynthesis: AnswerSynthesisService;
  private readonly evidenceLimit: number;
  private readonly contextAssembler?: ContextAssembler;
  private readonly evidencePlanner: EvidencePlanner;
  private readonly contextLimitTokens?: number;
  private readonly reservedOutputTokens?: number;
  private readonly graphContext?: ContextAssembleRequest["graph"];
  private readonly chatModel: ChatModelProvider;
  private readonly chatModelName: string;
  private readonly chatOptions: Pick<ChatRequest, "temperature" | "maxTokens">;
  private readonly toolsEnabled: boolean;
  private readonly getIndexStatus?: () => ContextIndexDiagnostics;
  private readonly forceEagerResearch: boolean;
  private readonly indexDescription?: IndexDescriptionPromptContext;
  private readonly retriever: ResearchRetriever;
  private readonly searchProvider?: SearchProvider;
  private readonly noteTools?: NoteToolService;
  private readonly toolCapabilities: ToolCallingCapabilities;
  private readonly toolCapabilityProvenance?: Record<string, string>;
  private readonly toolCapabilityProbeAudit?: ToolCapabilityProbeAudit;
  private readonly now: () => Date;
  private readonly persistFinalAnswer?: (answer: ResearchAnswer) => void | Promise<void>;
  private readonly apiFormat?: ApiFormat;
  private readonly modelRound?: ModelRoundProvider;
  private readonly reasoning?: ResearchServiceOptions["reasoning"];
  private readonly reasoningDiagnostics?: ResearchServiceOptions["reasoningDiagnostics"];

  constructor(options: ResearchServiceOptions) {
    this.evidenceLimit = options.evidenceLimit ?? DEFAULT_EVIDENCE_LIMIT;
    this.contextAssembler = options.contextAssembler;
    this.evidencePlanner = new EvidencePlanner(options.evidencePlanner);
    this.contextLimitTokens = options.contextLimitTokens;
    this.reservedOutputTokens = options.chatOptions?.maxTokens;
    this.graphContext = options.graphContext;
    const chatOptions = {
      temperature: options.chatOptions?.temperature ?? options.temperature ?? DEFAULT_TEMPERATURE,
      maxTokens: options.chatOptions?.maxTokens,
    };
    this.chatModel = options.chatModel;
    this.chatModelName = options.chatModelName;
    this.chatOptions = chatOptions;
    this.toolsEnabled = options.toolsEnabled === true && options.noteTools !== undefined;
    this.getIndexStatus = options.getIndexStatus;
    this.forceEagerResearch = options.forceEagerResearch === true;
    this.indexDescription = options.indexDescription;
    const now = options.now ?? (() => new Date());
    this.now = now;
    this.persistFinalAnswer = options.persistFinalAnswer;
    this.retriever = options.retriever;
    this.searchProvider = options.searchProvider;
    this.noteTools = options.noteTools;
    this.toolCapabilities = options.toolCapabilities ?? {
      calls: false,
      choiceRequired: false,
      choiceSpecific: false,
      parallelCalls: false,
    };
    this.toolCapabilityProvenance = options.toolCapabilityProvenance;
    this.toolCapabilityProbeAudit = options.toolCapabilityProbeAudit;
    this.apiFormat = options.apiFormat;
    this.modelRound = options.modelRound;
    this.reasoning = options.reasoning;
    this.reasoningDiagnostics = options.reasoningDiagnostics;

    this.vaultPipeline = new VaultResearchPipeline({
      retriever: options.retriever,
      queryExpansion: options.queryExpansion,
      evidenceLimit: this.evidenceLimit,
    });
    this.webPipeline = new WebResearchPipeline({
      searchProvider: options.searchProvider,
      chatModel: options.chatModel,
      chatModelName: options.chatModelName,
      chatOptions,
      evidenceLimit: this.evidenceLimit,
    });
    this.answerSynthesis = new AnswerSynthesisService({
      chatModel: options.chatModel,
      modelRound: options.modelRound,
      reasoning: options.reasoning,
      reasoningDiagnostics: options.reasoningDiagnostics,
      chatModelName: options.chatModelName,
      chatOptions,
      contextLimitTokens: options.contextLimitTokens,
      now,
      persistFinalAnswer: options.persistFinalAnswer,
      noteTools: options.noteTools,
    });
  }

  async *answer(request: ResearchRequest): AsyncIterable<ResearchStreamEvent> {
    let question = request.question.trim();
    const searchMode = resolveSearchMode(request);
    const policy = resolveResearchExecutionPolicy({
      forceEagerResearch: this.forceEagerResearch,
      deepResearch: request.deepResearch === true,
      searchMode,
      dependencies: {
        retriever: true,
        webProvider: this.searchProvider !== undefined,
      },
      capabilities: this.toolCapabilities,
      apiFormat: this.apiFormat,
    });
    let executionStrategy = policy.strategy;
    let failedAgenticAttempt: AgenticResearchFailure | undefined;
    const indexDescription =
      searchMode === "indexOnly" || searchMode === "indexAndWeb"
        ? this.indexDescription
        : undefined;
    if (policy.strategy === "agentic") {
      yield { type: "status", message: "Synthesizing answer..." };
      const liveEvents = createAsyncEventChannel<ResearchStreamEvent>();
      const agenticPromise = this.answerAgentically({
        request,
        question,
        searchMode,
        policy,
        indexDescription,
        onEvent: (event) => liveEvents.push(event),
      }).finally(() => liveEvents.close());
      for await (const event of liveEvents) yield event;
      const agentic = await agenticPromise;
      if (agentic.result.ok) {
        if (agentic.diagnostics) yield { type: "context", diagnostics: agentic.diagnostics };
        yield { type: "complete", answer: agentic.answer };
        return;
      }
      if (agentic.result.reason === "cancelled") return;
      // All non-cancel failures (including provider-error) fall through to the
      // deterministic fallback so a diagnostic report is still produced. Throwing
      // here would surface a generic error with no diagnostics to debug from.
      const partialEvidence = agentic.answer.evidence ?? [];
      if (partialEvidence.length > 0) {
        yield { type: "status", message: "Synthesizing from partial results…" };
        yield* this.answerSynthesis.synthesize({
          question,
          evidence: partialEvidence,
          citations: agentic.answer.citations ?? [],
          chatHistory: request.chatHistory,
          evidenceLimit: this.evidenceLimit,
          contextDiagnostics:
            request.includeContextDiagnostics === true ? agentic.diagnostics : undefined,
          signal: request.signal,
          fallback: { reason: agentic.result.reason },
        });
        return;
      }
      failedAgenticAttempt = agentic.result;
      executionStrategy = "deterministic-fallback";
    }

    const deepResearch = request.deepResearch === true;
    const totalReservedTokens = this.reservedOutputTokens ?? 0;
    const totalReservedWithIndexTokens =
      totalReservedTokens + (indexDescription ? estimateTextTokens(indexDescription.text) : 0);
    const assembled =
      searchMode === "webOnly" || !this.contextAssembler
        ? undefined
        : await this.contextAssembler.assemble({
          question,
          contextMode: searchMode === "none" ? "include" : (request.contextMode ?? "include"),
          contextPaths: request.contextPaths ?? [],
          activeFilePath: request.activeFilePath,
          includeActiveFile: request.includeActiveFile === true,
          chatHistory: request.chatHistory,
          contextLimitTokens: this.contextLimitTokens,
          reservedOutputTokens: totalReservedWithIndexTokens,
          evidenceLimit: this.evidenceLimit,
          skipRetrieval: searchMode === "none",
          explicitSourcesOnly: searchMode === "none",
          graph: this.graphContext,
        });
    if (assembled) {
      assembled.diagnostics.executionStrategy = executionStrategy;
      assembled.diagnostics.question = question;
      assembled.diagnostics.modelName = this.chatModelName;
      assembled.diagnostics.modelApiFormat = this.apiFormat;
      assembled.diagnostics.searchMode = searchMode;
      if (this.toolCapabilityProbeAudit)
        assembled.diagnostics.probeAudit = this.toolCapabilityProbeAudit;
      assembled.diagnostics.toolCapabilities = this.toolCapabilities;
    }
    if (assembled) {
      yield { type: "context", diagnostics: assembled.diagnostics };
    }
    const retrieval =
      searchMode === "webOnly" || searchMode === "none"
        ? emptyRetrievalResult()
        : yield* this.vaultPipeline.search(
          question,
          assembled?.retrievalSourcePaths ?? request.contextPaths,
          assembled?.boostedSourcePaths,
        );
    const webEvidence = yield* this.webPipeline.search(
      question,
      searchMode !== "indexOnly" && searchMode !== "none",
      deepResearch,
    );
    const contextDiagnostics = withRetrievalDiagnostics(
      assembled?.diagnostics ??
      createEmptyContextDiagnostics(request.contextMode ?? "include", executionStrategy),
      retrieval,
    );
    contextDiagnostics.question = question;
    contextDiagnostics.modelName = this.chatModelName;
    contextDiagnostics.modelApiFormat = this.apiFormat;
    contextDiagnostics.searchMode = searchMode;
    contextDiagnostics.toolCapabilities = this.toolCapabilities;
    if (this.toolCapabilityProbeAudit)
      contextDiagnostics.probeAudit = this.toolCapabilityProbeAudit;
    if (this.getIndexStatus) {
      contextDiagnostics.index = this.getIndexStatus();
    }
    const rawGraphEvidence = graphEvidenceFromRetrieval(
      retrieval.chunks,
      assembled?.graphSourcePaths ?? [],
    );
    const rawRetrievalEvidence = nonExplicitEvidence(retrieval.chunks, rawGraphEvidence);

    const planned = this.evidencePlanner.plan({
      question,
      chatHistory: request.chatHistory,
      contextLimitTokens: this.contextLimitTokens,
      reservedOutputTokens: totalReservedWithIndexTokens,
      evidenceLimit: this.evidenceLimit,
      searchMode,
      explicitEvidence: assembled?.explicitEvidence ?? [],
      graphEvidence: rawGraphEvidence,
      retrievalEvidence: rawRetrievalEvidence,
      webEvidence: webEvidence.chunks,
      expandedEvidence: searchMode === "none" ? undefined : request.expandedEvidence,
      expandedCitationKeys: searchMode === "none" ? undefined : request.expandedCitationKeys,
    });
    const explicitCitations = (assembled?.explicitEvidence ?? []).map((chunk) => ({
      ...formatCitation(chunk.source),
      id: chunk.id,
    }));
    const citations = citationsForEvidence(
      planned.finalEvidence,
      mergeCitations(mergeCitations(explicitCitations, retrieval.citations), webEvidence.citations),
    );
    const diagnostics = withWebDiagnostics(
      withPlannerDiagnostics(contextDiagnostics, planned.diagnostics),
      webEvidence.diagnostics,
      planned.webEvidence,
    );
    if (indexDescription) {
      diagnostics.indexDescription = { ...indexDescription.diagnostics };
      if (indexDescription.diagnostics.freshness !== "current") {
        diagnostics.warnings.push(
          `Index description used ${indexDescription.diagnostics.freshness} deterministic fallback metadata.`,
        );
      }
    }
    if (failedAgenticAttempt) {
      diagnostics.agentic = {
        policyReason: policy.reason,
        requiredTools: [...policy.requiredTools],
        bootstrapChoice: policy.bootstrapChoice,
        satisfiedTools: failedAgenticAttempt.satisfiedTools,
        repairedTools: failedAgenticAttempt.repairedTools,
        rounds: failedAgenticAttempt.rounds,
        totalCalls: failedAgenticAttempt.totalCalls,
        duplicateCalls: failedAgenticAttempt.duplicateCalls,
        fallbackReason: failedAgenticAttempt.reason,
        duplicatedCost: true,
        capabilityProvenance: this.toolCapabilityProvenance,
        phases: failedAgenticAttempt.phases,
        reasoningSegments: failedAgenticAttempt.reasoningSegments,
        stopReasons: failedAgenticAttempt.stopReasons,
        budgets: agenticBudgets(failedAgenticAttempt.totalResultChars),
      };
    } else if (policy.strategy === "deterministic-fallback") {
      diagnostics.agentic = {
        policyReason: policy.reason,
        requiredTools: [...policy.requiredTools],
        bootstrapChoice: policy.bootstrapChoice,
        satisfiedTools: [],
        repairedTools: [],
        rounds: 0,
        totalCalls: 0,
        duplicateCalls: 0,
        fallbackReason: policy.reason,
        duplicatedCost: false,
        capabilityProvenance: this.toolCapabilityProvenance,
      };
    }

    yield* this.answerSynthesis.synthesize({
      question,
      chatHistory: request.chatHistory,
      evidence: planned.finalEvidence,
      explicitEvidence: planned.explicitEvidence,
      graphEvidence: planned.graphEvidence,
      retrievedEvidence: planned.retrievedEvidence,
      webEvidence: planned.webEvidence,
      citations,
      contextDiagnostics: request.includeContextDiagnostics === true ? diagnostics : undefined,
      evidenceLimit: this.evidenceLimit,
      toolsEnabled: this.toolsEnabled,
      retrievalDiagnostics: isRagDebugIntent(question)
        ? buildRagDiagnosticSnapshot(diagnostics)
        : undefined,
      indexDescription,
      signal: request.signal,
    });
  }

  private async answerAgentically(options: {
    request: ResearchRequest;
    question: string;
    searchMode: ResearchSearchMode;
    policy: ReturnType<typeof resolveResearchExecutionPolicy>;
    indexDescription?: IndexDescriptionPromptContext;
    onEvent?(event: ResearchStreamEvent): void;
  }): Promise<{
    result: Awaited<ReturnType<AgenticResearchRunner["run"]>>;
    answer: ResearchAnswer;
    diagnostics?: ContextDiagnostics;
  }> {
    const assembled = this.contextAssembler
      ? await this.contextAssembler.assemble({
        question: options.question,
        contextMode: options.request.contextMode ?? "include",
        contextPaths: options.request.contextPaths ?? [],
        includeActiveFile: false,
        chatHistory: options.request.chatHistory,
        contextLimitTokens: this.contextLimitTokens,
        reservedOutputTokens: this.reservedOutputTokens,
        evidenceLimit: this.evidenceLimit,
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
    if (options.request.includeActiveFile && options.request.activeFilePath && this.noteTools) {
      try {
        const activeResult = await this.noteTools.execute({
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

    const created = createResearchToolRegistry({
      availability: {
        searchMode: options.searchMode,
        noteAccess: this.noteTools !== undefined,
        activeFileAccess:
          this.noteTools !== undefined && options.request.includeActiveFile === true,
        noteMutationAccess: this.noteTools?.mutationEnabled() === true,
        retrieverAvailable: true,
        webProviderAvailable: this.searchProvider !== undefined,
      },
      noteTools: this.noteTools,
      retriever: this.retriever,
      searchProvider: this.searchProvider,
    });
    const messages = buildAgenticResearchMessages({
      question: options.question,
      chatHistory: options.request.chatHistory,
      requiredTools: options.policy.requiredTools,
      explicitEvidence: [...(assembled?.explicitEvidence ?? []), ...activeNoteEvidence],
      activeSkills: {
        coreVariant: options.searchMode === "none" ? "vault" : "research",
        index: options.searchMode === "indexOnly" || options.searchMode === "indexAndWeb",
        web: options.searchMode === "webOnly" || options.searchMode === "indexAndWeb",
        indexDescription: options.indexDescription?.text,
        noteMutationAccess: this.noteTools?.mutationEnabled() === true,
      },
    });
    const estimatedTokens =
      estimateTextTokens(messages.map((message) => message.content).join("\n")) +
      estimateTextTokens(JSON.stringify(created.tools.definitions())) +
      (this.reservedOutputTokens ?? 0);
    let result: Awaited<ReturnType<AgenticResearchRunner["run"]>>;
    if (this.contextLimitTokens && estimatedTokens > this.contextLimitTokens) {
      result = emptyAgenticFailure("context-limit-exceeded");
    } else {
      result = await new AgenticResearchRunner({
        chatModel: this.chatModel,
        modelRound: this.modelRound,
        model: this.chatModelName,
        messages,
        tools: created.tools,
        policy: options.policy,
        temperature: this.chatOptions.temperature,
        maxTokens: this.chatOptions.maxTokens,
        reasoning: this.reasoning,
        signal: options.request.signal,
        onDelta: (delta, round) => {
          if (delta.type === "text") {
            options.onEvent?.({
              type: "checkpoint-delta",
              checkpointId: `round-${round}`,
              round,
              content: delta.text,
            });
          } else {
            options.onEvent?.({
              type: "reasoning",
              segmentId: delta.segmentId ?? `reasoning-${round}`,
              content: delta.text,
            });
          }
        },
        onRoundClassified: (round, classification) =>
          options.onEvent?.({
            type: classification === "final" ? "checkpoint-promote" : "checkpoint-complete",
            checkpointId: `round-${round}`,
            round,
          }),
        onToolCall: (id, name, label, round, args) =>
          options.onEvent?.({ type: "tool-call-start", id, name, label, round, args }),
        onToolResult: (id, ok, resolvedLabel, resultSummary, resultJson) =>
          options.onEvent?.({
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
        options.request.contextMode ?? "include",
        result.ok ? "agentic" : "deterministic-fallback",
      );
    diagnostics.executionStrategy = result.ok ? "agentic" : "deterministic-fallback";
    diagnostics.question = options.question;
    diagnostics.modelName = this.chatModelName;
    diagnostics.modelApiFormat = this.apiFormat;
    diagnostics.searchMode = options.searchMode;
    if (this.toolCapabilityProbeAudit) diagnostics.probeAudit = this.toolCapabilityProbeAudit;
    diagnostics.toolCapabilities = this.toolCapabilities;
    diagnostics.tools = result.diagnostics;
    diagnostics.agentic = {
      policyReason: options.policy.reason,
      requiredTools: [...options.policy.requiredTools],
      bootstrapChoice: options.policy.bootstrapChoice,
      satisfiedTools: result.satisfiedTools,
      repairedTools: result.repairedTools,
      rounds: result.rounds,
      totalCalls: result.totalCalls,
      duplicateCalls: result.duplicateCalls,
      ...(!result.ok ? { fallbackReason: result.reason } : {}),
      duplicatedCost: !result.ok,
      capabilityProvenance: this.toolCapabilityProvenance,
      ...(unknownCitationIds.length > 0 ? { unknownCitationIds } : {}),
      phases: result.phases,
      reasoningSegments: result.reasoningSegments,
      stopReasons: result.stopReasons,
      budgets: agenticBudgets(result.totalResultChars),
    };
    if (this.reasoningDiagnostics) {
      diagnostics.reasoning = {
        ...this.reasoningDiagnostics,
        ...(this.reasoning?.effort ? { configuredEffort: this.reasoning.effort } : {}),
        summaryRequested: this.reasoning?.summary === "auto",
        reasoningItemCount: result.reasoningItemCount,
        continuationRounds: result.continuationRounds,
        ...result.usage,
      };
    }
    if (options.indexDescription)
      diagnostics.indexDescription = { ...options.indexDescription.diagnostics };
    const answer: ResearchAnswer = {
      question: options.question,
      answer: result.ok ? result.answerText : "",
      citations,
      evidence,
      ...(options.request.includeContextDiagnostics === true
        ? { contextDiagnostics: diagnostics }
        : {}),
      followUpQuestions: result.ok ? extractFollowUpQuestions(result.answerText) : [],
      createdAt: this.now().toISOString(),
    };
    if (result.ok && this.persistFinalAnswer) await this.persistFinalAnswer(answer);
    return {
      result,
      answer,
      diagnostics: options.request.includeContextDiagnostics ? diagnostics : undefined,
    };
  }

  async expandAdjacentEvidence(
    chunks: RetrievedChunk[],
    radius: number,
    limit: number,
  ): Promise<RetrievedChunk[]> {
    if (!this.vaultPipeline.expandAdjacentEvidence) {
      return chunks.slice(0, limit);
    }

    return this.vaultPipeline.expandAdjacentEvidence(chunks, radius, limit);
  }

  async summarizeChatHistoryForCompaction(
    messages: ChatDisplayMessage[],
    existingSummary?: ConversationCompactionSummary,
  ): Promise<ConversationCompactionSummary> {
    return summarizeCompactionWithModel({
      chatModel: this.chatModel,
      model: this.chatModelName,
      messages,
      existingSummary,
      temperature: 0,
      maxTokens: this.chatOptions.maxTokens,
    });
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

function agenticBudgets(usedResultChars: number) {
  return {
    maxRounds: 30,
    maxResultChars: 50_000,
    usedResultChars,
  };
}

function citationIdsFromText(text: string): Set<string> {
  return new Set(
    [...text.matchAll(/\[([^\]\n]{1,200})\]/g)].map((match) => match[1].trim()).filter(Boolean),
  );
}

function dedupeEvidence(evidence: readonly RetrievedChunk[]): RetrievedChunk[] {
  const seen = new Set<string>();
  return evidence.filter((chunk) => {
    if (seen.has(chunk.id)) return false;
    seen.add(chunk.id);
    return true;
  });
}

function graphEvidenceFromRetrieval(
  chunks: RetrievedChunk[],
  graphSourcePaths: string[],
): RetrievedChunk[] {
  if (graphSourcePaths.length === 0) {
    return [];
  }

  const graphPaths = new Set(graphSourcePaths);

  return chunks.filter((chunk) => "path" in chunk.source && graphPaths.has(chunk.source.path));
}

function nonExplicitEvidence(
  evidence: RetrievedChunk[],
  explicitEvidence: RetrievedChunk[],
): RetrievedChunk[] {
  const explicitIds = new Set(explicitEvidence.map((chunk) => chunk.id));
  return evidence.filter((chunk) => !explicitIds.has(chunk.id));
}

function withRetrievalDiagnostics(
  diagnostics: ContextDiagnostics,
  retrieval: RetrievalResult,
): ContextDiagnostics {
  const rankedChunks = retrieval.chunks.map((chunk, index) => {
    const path = "path" in chunk.source ? chunk.source.path : chunk.source.title;
    return {
      id: chunk.id,
      path,
      rank: index + 1,
      score: chunk.score,
      status: "included" as const,
    };
  });
  return {
    ...diagnostics,
    retrieval: {
      ...diagnostics.retrieval,
      queryVariants: (retrieval.queryVariants ?? []).map((variant) => variant.query),
      includedChunkIds: retrieval.chunks.map((chunk) => chunk.id),
      droppedChunkIds: [],
      rankedChunks,
    },
  };
}

function withPlannerDiagnostics(
  diagnostics: ContextDiagnostics,
  plannerDiagnostics: ContextDiagnostics["evidencePlanner"],
): ContextDiagnostics {
  const droppedRetrieval = new Set(plannerDiagnostics?.dropped.retrievalChunkIds ?? []);
  const rankedChunks = diagnostics.retrieval.rankedChunks?.map((chunk) =>
    droppedRetrieval.has(chunk.id) && chunk.status === "included"
      ? { ...chunk, status: "dropped" as const, reason: "evidence-planner" }
      : chunk,
  );
  return {
    ...diagnostics,
    evidencePlanner: plannerDiagnostics,
    retrieval: {
      ...diagnostics.retrieval,
      ...(rankedChunks ? { rankedChunks } : {}),
      includedChunkIds:
        rankedChunks?.filter((chunk) => chunk.status === "included").map((chunk) => chunk.id) ??
        diagnostics.retrieval.includedChunkIds,
      droppedChunkIds: Array.from(
        new Set([
          ...diagnostics.retrieval.droppedChunkIds,
          ...(plannerDiagnostics?.dropped.retrievalChunkIds ?? []),
        ]),
      ),
    },
    budget: {
      ...diagnostics.budget,
      groups: plannerDiagnostics?.budget.groups ?? diagnostics.budget.groups,
    },
  };
}

function withWebDiagnostics(
  diagnostics: ContextDiagnostics,
  webDiagnostics: WebContextDiagnostics | undefined,
  promptEvidence: RetrievedChunk[],
): ContextDiagnostics {
  if (!webDiagnostics) {
    return diagnostics;
  }

  const promptOrder = new Map(promptEvidence.map((chunk, index) => [chunk.id, index + 1]));

  return {
    ...diagnostics,
    web: {
      ...webDiagnostics,
      results: webDiagnostics.results.map((result) => {
        if (result.status !== "candidate") {
          return result;
        }

        const order = promptOrder.get(result.chunkId);
        return order === undefined
          ? { ...result, status: "dropped", reason: "evidence-planner" }
          : { ...result, status: "included", promptOrder: order };
      }),
      finalPrompt: {
        includedChunkIds: promptEvidence.map((chunk) => chunk.id),
        usedTokens: promptEvidence.reduce(
          (total, chunk) => total + estimateTextTokens(chunk.text),
          0,
        ),
      },
    },
  };
}

function mergeCitations(primary: Citation[], secondary: Citation[]): Citation[] {
  const seen = new Set<string>();
  const citations: Citation[] = [];

  for (const citation of [...primary, ...secondary]) {
    if (!seen.has(citation.id)) {
      citations.push(citation);
      seen.add(citation.id);
    }
  }

  return citations;
}

function citationsForEvidence(evidence: RetrievedChunk[], citations: Citation[]): Citation[] {
  const evidenceIds = new Set(evidence.map((chunk) => chunk.id));

  return citations.filter((citation) => evidenceIds.has(citation.id));
}

function resolveSearchMode(request: ResearchRequest): ResearchSearchMode {
  return request.searchMode ?? (request.includeWebSearch === true ? "indexAndWeb" : "indexOnly");
}

function emptyRetrievalResult(): RetrievalResult {
  return {
    chunks: [],
    citations: [],
    usedFallback: false,
  };
}

function createEmptyContextDiagnostics(
  contextMode: ContextMode,
  executionStrategy: ResearchExecutionStrategy,
): ContextDiagnostics {
  return {
    executionStrategy,
    contextMode,
    explicitSources: [],
    mentionSources: [],
    activeSources: [],
    graph: {
      enabled: false,
      source: "none",
      depth: 0,
      rootPaths: [],
      included: [],
      dropped: [],
      unresolved: [],
      limits: {
        maxForwardLinksPerRoot: 0,
        maxEmbedsPerRoot: 0,
        maxBacklinksPerRoot: 0,
        maxGraphCandidatesTotal: 0,
      },
    },
    retrieval: {
      queryVariants: [],
      includedChunkIds: [],
      droppedChunkIds: [],
      filteredSourcePaths: [],
    },
    budget: {
      usedTokens: 0,
      groups: [],
    },
    tools: [],
    warnings: [],
  };
}

export function selectResearchExecutionStrategy(
  forceEagerResearch: boolean,
): ResearchExecutionStrategy {
  return forceEagerResearch ? "eager-forced" : "eager-default";
}

function isRagDebugIntent(question: string): boolean {
  return /(rag|retrieval|чанк|почему[^?]*(?:не наш|плох)|диагностик)/i.test(question);
}

function isChunkList(value: unknown): value is {
  chunks: Array<{
    id: string;
    text: string;
    evidenceSource: import("../shared/types").SourceReference;
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

function buildRagDiagnosticSnapshot(diagnostics: ContextDiagnostics): string {
  return JSON.stringify({
    queryVariants: diagnostics.retrieval.queryVariants,
    rankedChunks: diagnostics.retrieval.rankedChunks?.slice(0, 20) ?? [],
    droppedChunkIds: diagnostics.retrieval.droppedChunkIds,
    filteredFiles: diagnostics.retrieval.filteredSourcePaths.map((path) => ({
      path,
      reason: "source-path-filter",
    })),
    budget: diagnostics.budget,
    tools: diagnostics.tools,
    index: diagnostics.index ?? { status: "unknown", available: false },
  });
}
