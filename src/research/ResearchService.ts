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
  ContextIndexDiagnostics,
  ResearchAnswer,
  RetrievedChunk,
  SearchProvider,
} from "../shared/types";
import { AnswerSynthesisService } from "./AnswerSynthesisService";
import { ContextAssembler, ContextAssembleRequest } from "./ContextAssembler";
import { EvidencePlanner, EvidencePlannerOptions } from "./EvidencePlanner";
import { NoteToolService } from "./NoteTools";
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
    this.toolsEnabled = options.toolsEnabled === true;
    this.skillRegistry = options.skillRegistry;
    this.getIndexStatus = options.getIndexStatus;
    const now = options.now ?? (() => new Date());

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
    let skillSnapshot: SkillCatalogSnapshot | undefined;
    let selectedSkill: SkillDefinition | undefined;
    let inlineSkill: LoadedSkill | undefined;
    let skillSelectionMode: "automatic" | "manual" | "none" = "none";
    let selectorWarning: string | undefined;

    if (this.skillRegistry) {
      skillSnapshot = await this.skillRegistry.getSnapshot({ refresh: true });
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
      } else if (!this.toolsEnabled) {
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

      if (selectedSkill && !this.toolsEnabled) {
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

    const searchMode = resolveSearchMode(request);
    const deepResearch = request.deepResearch === true;
    const skillReservedTokens = skillSnapshot
      ? estimateTextTokens(buildSkillCatalogPrompt(skillSnapshot.skills)) +
        (inlineSkill?.estimatedTokens ??
          (this.toolsEnabled ? (this.skillRegistry?.maxDiscoveredSkillTokens() ?? 0) : 0))
      : 0;
    const totalReservedTokens = (this.reservedOutputTokens ?? 0) + skillReservedTokens;
    const assembled =
      searchMode === "webOnly" || !this.contextAssembler
        ? undefined
        : await this.contextAssembler.assemble({
            question,
            contextMode: request.contextMode ?? "include",
            contextPaths: request.contextPaths ?? [],
            activeFilePath: request.activeFilePath,
            includeActiveFile: request.includeActiveFile === true,
            chatHistory: request.chatHistory,
            contextLimitTokens: this.contextLimitTokens,
            reservedOutputTokens: totalReservedTokens,
            evidenceLimit: this.evidenceLimit,
            graph: this.graphContext,
          });
    if (assembled) {
      yield { type: "context", diagnostics: assembled.diagnostics };
    }
    const rawRetrieval =
      searchMode === "webOnly"
        ? emptyRetrievalResult()
        : yield* this.vaultPipeline.search(
            question,
            assembled?.retrievalSourcePaths ?? request.contextPaths,
            assembled?.boostedSourcePaths,
          );
    const retrieval = withoutInternalSkillEvidence(rawRetrieval);
    const webEvidence = yield* this.webPipeline.search(
      question,
      searchMode !== "indexOnly",
      deepResearch,
    );
    const contextDiagnostics = withRetrievalDiagnostics(
      assembled?.diagnostics ?? createEmptyContextDiagnostics(request.contextMode ?? "include"),
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
      reservedOutputTokens: totalReservedTokens,
      evidenceLimit: this.evidenceLimit,
      searchMode,
      explicitEvidence: assembled?.explicitEvidence ?? [],
      graphEvidence: rawGraphEvidence,
      retrievalEvidence: rawRetrievalEvidence,
      webEvidence: webEvidence.chunks,
      expandedEvidence: request.expandedEvidence,
      expandedCitationKeys: request.expandedCitationKeys,
    });
    const explicitCitations = (assembled?.explicitEvidence ?? []).map((chunk) => ({
      ...formatCitation(chunk.source),
      id: chunk.id,
    }));
    const citations = citationsForEvidence(
      planned.finalEvidence,
      mergeCitations(mergeCitations(explicitCitations, retrieval.citations), webEvidence.citations),
    );
    const diagnostics = withPlannerDiagnostics(contextDiagnostics, planned.diagnostics);
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
      toolsEnabled: this.toolsEnabled && searchMode !== "webOnly",
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
    });
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

function createEmptyContextDiagnostics(contextMode: ContextMode): ContextDiagnostics {
  return {
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

function isRagDebugIntent(question: string): boolean {
  return /(rag|retrieval|чанк|почему[^?]*(?:не наш|плох)|диагностик)/i.test(question);
}

function buildRagDiagnosticSnapshot(diagnostics: ContextDiagnostics): string {
  return JSON.stringify({
    queryVariants: diagnostics.retrieval.queryVariants,
    rankedChunks: diagnostics.retrieval.rankedChunks?.slice(0, 20) ?? [],
    droppedChunkIds: diagnostics.retrieval.droppedChunkIds,
    filteredSourcePaths: diagnostics.retrieval.filteredSourcePaths,
    budget: diagnostics.budget,
    tools: diagnostics.tools,
    index: diagnostics.index ?? { status: "unknown", available: false },
  });
}
