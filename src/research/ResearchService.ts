import { RetrievalResult } from "../retrieval/RetrievalService";
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
import { ChatDisplayMessage, ConversationCompactionSummary } from "../ui/rendering";
import {
  buildSkillCatalogPrompt,
  LoadedSkill,
  resolveExplicitSkill,
  SkillCatalogSnapshot,
  SkillDefinition,
  SkillLoadError,
  SkillRegistry,
} from "../skills/SkillRegistry";
import { SkillSelectionService } from "../skills/SkillSelectionService";
import { estimateTextTokens } from "./prompts";
import { IxplorerError } from "../shared/errors";
import { isInternalSkillPath } from "../shared/pathFilters";
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
  skillRegistry?: SkillRegistry;
  getIndexStatus?: () => ContextIndexDiagnostics;
  forceEagerResearch?: boolean;
  indexDescription?: IndexDescriptionPromptContext;
  toolCapabilities?: ToolCallingCapabilities;
  toolCapabilityProvenance?: Record<string, string>;
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
  private readonly skillRegistry?: SkillRegistry;
  private readonly getIndexStatus?: () => ContextIndexDiagnostics;
  private readonly forceEagerResearch: boolean;
  private readonly indexDescription?: IndexDescriptionPromptContext;
  private readonly retriever: ResearchRetriever;
  private readonly searchProvider?: SearchProvider;
  private readonly noteTools?: NoteToolService;
  private readonly toolCapabilities: ToolCallingCapabilities;
  private readonly toolCapabilityProvenance?: Record<string, string>;
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
    this.skillRegistry = options.skillRegistry;
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
      includeActiveFile: request.includeActiveFile === true && Boolean(request.activeFilePath),
      dependencies: {
        retriever: true,
        webProvider: this.searchProvider !== undefined,
        activeFileAccess: this.noteTools !== undefined,
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
    let skillToolsEnabled =
      this.toolsEnabled && (policy.strategy === "agentic" || searchMode !== "webOnly");
    let skillSnapshot: SkillCatalogSnapshot | undefined;
    let selectedSkill: SkillDefinition | undefined;
    let inlineSkill: LoadedSkill | undefined;
    let skillSelectionMode: "automatic" | "manual" | "none" = "none";
    let selectorWarning: string | undefined;

    if (this.skillRegistry) {
      skillSnapshot = await this.skillRegistry.getSnapshot();
      const explicit = resolveExplicitSkill(question, skillSnapshot.skills);
      if (explicit.kind === "error") {
        throw new IxplorerError({
          code: "INVALID_SKILL_SELECTION",
          details: { reason: explicit.reason, mentions: explicit.mentions },
        });
      }
      question = explicit.normalizedQuestion;
      if (explicit.kind === "selected") {
        selectedSkill = explicit.skill;
        skillSelectionMode = "manual";
      } else if (!skillToolsEnabled) {
        yield { type: "status", message: "Selecting skill..." };
        const selection = await new SkillSelectionService({
          chatModel: this.chatModel,
          model: this.chatModelName,
        }).select(question, skillSnapshot.skills);
        selectedSkill = selection.skill;
        selectorWarning = selection.warning;
        if (selectedSkill) {
          skillSelectionMode = "automatic";
        }
      }

      if (selectedSkill && !skillToolsEnabled) {
        const catalogTokens = estimateTextTokens(buildSkillCatalogPrompt(skillSnapshot.skills));
        const maxSkillTokens = this.contextLimitTokens
          ? Math.max(0, this.contextLimitTokens - (this.reservedOutputTokens ?? 0) - catalogTokens)
          : undefined;
        try {
          inlineSkill = await this.skillRegistry.load(selectedSkill, {
            maxTokens: maxSkillTokens,
          });
        } catch (error) {
          if (error instanceof SkillLoadError && error.code === "skill-too-large") {
            throw new IxplorerError({
              code: "SKILL_TOO_LARGE",
              cause: error,
              details: { skillId: selectedSkill.id },
            });
          }
          throw error;
        }
      }
    }

    if (policy.strategy === "agentic") {
      yield { type: "status", message: "Synthesizing answer..." };
      const liveEvents = createAsyncEventChannel<ResearchStreamEvent>();
      const agenticPromise = this.answerAgentically({
        request,
        question,
        searchMode,
        policy,
        indexDescription,
        skillSnapshot,
        selectedSkill,
        skillSelectionMode,
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
      failedAgenticAttempt = agentic.result;
      executionStrategy = "deterministic-fallback";
      if (searchMode === "webOnly" && skillToolsEnabled) {
        skillToolsEnabled = false;
        if (skillSnapshot && !selectedSkill) {
          const selection = await new SkillSelectionService({
            chatModel: this.chatModel,
            model: this.chatModelName,
          }).select(question, skillSnapshot.skills);
          selectedSkill = selection.skill;
          selectorWarning = selection.warning;
          if (selectedSkill) skillSelectionMode = "automatic";
        }
        if (selectedSkill) {
          const catalogTokens = estimateTextTokens(
            buildSkillCatalogPrompt(skillSnapshot?.skills ?? []),
          );
          const maxSkillTokens = this.contextLimitTokens
            ? Math.max(
                0,
                this.contextLimitTokens - (this.reservedOutputTokens ?? 0) - catalogTokens,
              )
            : undefined;
          inlineSkill = await this.skillRegistry?.load(selectedSkill, {
            maxTokens: maxSkillTokens,
          });
        }
      }
    }

    const deepResearch = request.deepResearch === true;
    const skillReservedTokens = skillSnapshot
      ? estimateTextTokens(buildSkillCatalogPrompt(skillSnapshot.skills)) +
        (inlineSkill?.estimatedTokens ??
          (skillToolsEnabled ? (this.skillRegistry?.maxDiscoveredSkillTokens() ?? 0) : 0))
      : 0;
    const totalReservedTokens = (this.reservedOutputTokens ?? 0) + skillReservedTokens;
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
    }
    if (assembled) {
      yield { type: "context", diagnostics: assembled.diagnostics };
    }
    const rawRetrieval =
      searchMode === "webOnly" || searchMode === "none"
        ? emptyRetrievalResult()
        : yield* this.vaultPipeline.search(
            question,
            assembled?.retrievalSourcePaths ?? request.contextPaths,
            assembled?.boostedSourcePaths,
          );
    const retrieval = withoutInternalSkillEvidence(rawRetrieval);
    const webEvidence = yield* this.webPipeline.search(
      question,
      searchMode !== "indexOnly" && searchMode !== "none",
      deepResearch,
    );
    const contextDiagnostics = withRetrievalDiagnostics(
      assembled?.diagnostics ??
        createEmptyContextDiagnostics(request.contextMode ?? "include", executionStrategy),
      retrieval,
      rawRetrieval,
    );
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
    if (skillSnapshot) {
      diagnostics.skills = {
        discoveredCount: skillSnapshot.skills.length,
        warnings: skillSnapshot.warnings,
        ...(selectedSkill
          ? {
              selectedId: selectedSkill.id,
              selectedName: selectedSkill.name,
              selectedPath: selectedSkill.path,
            }
          : {}),
        selectionMode: skillSelectionMode,
        loadMode: inlineSkill ? "inline" : selectedSkill ? "read_note" : "none",
        loadStatus: inlineSkill ? "loaded" : selectedSkill ? "selected" : "not-selected",
        ...(inlineSkill
          ? {
              loadedCharacters: inlineSkill.characters,
              loadedTokens: inlineSkill.estimatedTokens,
              truncated: false as const,
            }
          : {}),
        ...(selectorWarning ? { selectorWarning } : {}),
      };
    }
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
        satisfiedTools: failedAgenticAttempt.satisfiedTools,
        repairedTools: failedAgenticAttempt.repairedTools,
        rounds: failedAgenticAttempt.rounds,
        totalCalls: failedAgenticAttempt.totalCalls,
        duplicateCalls: failedAgenticAttempt.duplicateCalls,
        fallbackReason: failedAgenticAttempt.reason,
        duplicatedCost: true,
        capabilityProvenance: this.toolCapabilityProvenance,
        phases: failedAgenticAttempt.phases,
        stopReasons: failedAgenticAttempt.stopReasons,
        budgets: agenticBudgets(failedAgenticAttempt.totalResultChars),
      };
    } else if (policy.strategy === "deterministic-fallback") {
      diagnostics.agentic = {
        policyReason: policy.reason,
        requiredTools: [...policy.requiredTools],
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
      toolsEnabled: skillToolsEnabled,
      skillCatalog: skillSnapshot?.skills,
      selectedSkill,
      inlineSkill,
      retrievalDiagnostics:
        selectedSkill?.id === "rag-debugger" || isRagDebugIntent(question)
          ? buildRagDiagnosticSnapshot(diagnostics)
          : undefined,
      skillToolResultChars: skillSnapshot
        ? Math.max(50_000, this.skillRegistry!.maxDiscoveredSkillTokens() * 4 + 2_000)
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
    skillSnapshot?: SkillCatalogSnapshot;
    selectedSkill?: SkillDefinition;
    skillSelectionMode: "automatic" | "manual" | "none";
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
    const created = createResearchToolRegistry({
      availability: {
        searchMode: options.searchMode,
        noteAccess:
          this.noteTools !== undefined &&
          (options.searchMode === "indexOnly" || options.searchMode === "indexAndWeb"),
        activeFileAccess:
          this.noteTools !== undefined && options.request.includeActiveFile === true,
        skillAccess: this.noteTools !== undefined && options.skillSnapshot !== undefined,
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
      explicitEvidence: assembled?.explicitEvidence,
      indexDescription: options.indexDescription?.text,
      skillCatalog: options.skillSnapshot
        ? buildSkillCatalogPrompt(options.skillSnapshot.skills)
        : undefined,
      noteMutationAccess: this.noteTools?.mutationEnabled() === true,
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
      }).run();
    }
    if (result.ok && !validSkillCalls(result.diagnostics, options.selectedSkill)) {
      result = {
        ...result,
        ok: false,
        reason: "skill-contract-violation",
      };
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
    diagnostics.tools = result.diagnostics;
    diagnostics.agentic = {
      policyReason: options.policy.reason,
      requiredTools: [...options.policy.requiredTools],
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
    if (options.skillSnapshot) {
      diagnostics.skills = {
        discoveredCount: options.skillSnapshot.skills.length,
        warnings: options.skillSnapshot.warnings,
        ...(options.selectedSkill
          ? {
              selectedId: options.selectedSkill.id,
              selectedName: options.selectedSkill.name,
              selectedPath: options.selectedSkill.path,
            }
          : {}),
        selectionMode: options.skillSelectionMode,
        loadMode: options.selectedSkill ? "read_note" : "none",
        loadStatus: options.selectedSkill ? "loaded" : "not-selected",
      };
    }
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
    continuationRounds: 0,
    usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
  };
}

function agenticBudgets(usedResultChars: number) {
  return {
    maxRounds: 5,
    maxCallsPerRound: 5,
    maxTotalCalls: 10,
    maxResultChars: 50_000,
    usedResultChars,
  };
}

function validSkillCalls(
  diagnostics: ContextDiagnostics["tools"],
  selectedSkill: SkillDefinition | undefined,
): boolean {
  const loaded = diagnostics.filter(
    (tool) =>
      tool.name === "read_note" &&
      tool.status === "success" &&
      typeof tool.metadata?.skillId === "string",
  );
  const paths = new Set(loaded.map((tool) => String(tool.arguments.path ?? "")));
  if (paths.size > 1) return false;
  return !selectedSkill || paths.has(selectedSkill.path);
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
  rawRetrieval: RetrievalResult = retrieval,
): ContextDiagnostics {
  const retainedIds = new Set(retrieval.chunks.map((chunk) => chunk.id));
  const rankedChunks = rawRetrieval.chunks.map((chunk, index) => {
    const path = "path" in chunk.source ? chunk.source.path : chunk.source.title;
    const filtered = !retainedIds.has(chunk.id);
    return {
      id: chunk.id,
      path,
      rank: index + 1,
      score: chunk.score,
      status: filtered ? ("filtered" as const) : ("included" as const),
      ...(filtered ? { reason: "internal-skill-path" } : {}),
    };
  });
  return {
    ...diagnostics,
    retrieval: {
      ...diagnostics.retrieval,
      queryVariants: (retrieval.queryVariants ?? []).map((variant) => variant.query),
      includedChunkIds: retrieval.chunks.map((chunk) => chunk.id),
      droppedChunkIds: rawRetrieval.chunks
        .filter((chunk) => !retainedIds.has(chunk.id))
        .map((chunk) => chunk.id),
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

function withoutInternalSkillEvidence(result: RetrievalResult): RetrievalResult {
  const chunks = result.chunks.filter(
    (chunk) => !("path" in chunk.source && isInternalSkillPath(chunk.source.path)),
  );
  const includedIds = new Set(chunks.map((chunk) => chunk.id));
  return {
    ...result,
    chunks,
    citations: result.citations.filter((citation) => includedIds.has(citation.id)),
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
