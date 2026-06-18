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
    const question = request.question.trim();
    const searchMode = resolveSearchMode(request);
    const deepResearch = request.deepResearch === true;
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
            reservedOutputTokens: this.reservedOutputTokens,
            evidenceLimit: this.evidenceLimit,
            graph: this.graphContext,
          });
    if (assembled) {
      yield { type: "context", diagnostics: assembled.diagnostics };
    }
    const retrieval =
      searchMode === "webOnly"
        ? emptyRetrievalResult()
        : yield* this.vaultPipeline.search(
            question,
            assembled?.retrievalSourcePaths ?? request.contextPaths,
            assembled?.boostedSourcePaths,
          );
    const webEvidence = yield* this.webPipeline.search(
      question,
      searchMode !== "indexOnly",
      deepResearch,
    );
    const contextDiagnostics = assembled
      ? withRetrievalDiagnostics(assembled.diagnostics, retrieval)
      : undefined;
    const rawGraphEvidence = graphEvidenceFromRetrieval(
      retrieval.chunks,
      assembled?.graphSourcePaths ?? [],
    );
    const rawRetrievalEvidence = nonExplicitEvidence(retrieval.chunks, rawGraphEvidence);
    const planned = this.evidencePlanner.plan({
      question,
      chatHistory: request.chatHistory,
      contextLimitTokens: this.contextLimitTokens,
      reservedOutputTokens: this.reservedOutputTokens,
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
    const diagnostics = withPlannerDiagnostics(
      contextDiagnostics ?? createEmptyContextDiagnostics(request.contextMode ?? "include"),
      planned.diagnostics,
    );

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
): ContextDiagnostics {
  return {
    ...diagnostics,
    retrieval: {
      ...diagnostics.retrieval,
      includedChunkIds: retrieval.chunks.map((chunk) => chunk.id),
    },
  };
}

function withPlannerDiagnostics(
  diagnostics: ContextDiagnostics,
  plannerDiagnostics: ContextDiagnostics["evidencePlanner"],
): ContextDiagnostics {
  return {
    ...diagnostics,
    evidencePlanner: plannerDiagnostics,
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
