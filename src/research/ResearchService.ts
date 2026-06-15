import { RetrievalResult } from "../retrieval/RetrievalService";
import { formatCitation } from "../retrieval/citations";
import { QueryExpansionService } from "../retrieval/QueryExpansionService";
import {
  ChatModelProvider,
  ChatRequest,
  Citation,
  ContextDiagnostics,
  ResearchAnswer,
  RetrievedChunk,
  SearchProvider,
} from "../shared/types";
import { AnswerSynthesisService } from "./AnswerSynthesisService";
import { ContextAssembler, ContextAssembleRequest } from "./ContextAssembler";
import { VaultResearchPipeline } from "./VaultResearchPipeline";
import { WebResearchPipeline } from "./WebResearchPipeline";
import {
  ResearchRequest,
  ResearchRetriever,
  ResearchSearchMode,
  ResearchStreamEvent,
} from "./types";

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
  contextLimitTokens?: number;
  temperature?: number;
  now?: () => Date;
  persistFinalAnswer?: (answer: ResearchAnswer) => void | Promise<void>;
}

const DEFAULT_EVIDENCE_LIMIT = 8;
const DEFAULT_TEMPERATURE = 0.2;
export class ResearchService {
  private readonly vaultPipeline: VaultResearchPipeline;
  private readonly webPipeline: WebResearchPipeline;
  private readonly answerSynthesis: AnswerSynthesisService;
  private readonly evidenceLimit: number;
  private readonly contextAssembler?: ContextAssembler;
  private readonly contextLimitTokens?: number;
  private readonly reservedOutputTokens?: number;
  private readonly graphContext?: ContextAssembleRequest["graph"];

  constructor(options: ResearchServiceOptions) {
    this.evidenceLimit = options.evidenceLimit ?? DEFAULT_EVIDENCE_LIMIT;
    this.contextAssembler = options.contextAssembler;
    this.contextLimitTokens = options.contextLimitTokens;
    this.reservedOutputTokens = options.chatOptions?.maxTokens;
    this.graphContext = options.graphContext;
    const chatOptions = {
      temperature: options.chatOptions?.temperature ?? options.temperature ?? DEFAULT_TEMPERATURE,
      maxTokens: options.chatOptions?.maxTokens,
    };
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
    const diagnostics = assembled
      ? withRetrievalDiagnostics(assembled.diagnostics, retrieval)
      : undefined;
    const localEvidence = mergeLocalEvidence(
      assembled?.explicitEvidence ?? [],
      retrieval.chunks,
      this.evidenceLimit,
    );
    const evidence = mergeEvidenceChunks(
      localEvidence,
      webEvidence.chunks,
      this.evidenceLimit,
      deepResearch,
    );
    const graphEvidence = graphEvidenceFromRetrieval(
      evidence,
      assembled?.graphSourcePaths ?? [],
    );
    const webPromptEvidence = evidence.filter((chunk) => chunk.source.kind === "web");
    const retrievedEvidence = nonExplicitEvidence(
      evidence,
      [...(assembled?.explicitEvidence ?? []), ...graphEvidence, ...webPromptEvidence],
    );
    const explicitCitations = (assembled?.explicitEvidence ?? []).map((chunk) => ({
      ...formatCitation(chunk.source),
      id: chunk.id,
    }));
    const citations = mergeCitations(
      mergeCitations(explicitCitations, retrieval.citations),
      webEvidence.citations,
    );

    yield* this.answerSynthesis.synthesize({
      question,
      chatHistory: request.chatHistory,
      evidence,
      explicitEvidence: assembled?.explicitEvidence,
      graphEvidence,
      retrievedEvidence,
      webEvidence: webPromptEvidence,
      citations,
      contextDiagnostics: diagnostics,
      evidenceLimit: this.evidenceLimit,
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

function mergeLocalEvidence(
  explicitChunks: RetrievedChunk[],
  retrievedChunks: RetrievedChunk[],
  limit: number,
): RetrievedChunk[] {
  const seen = new Set<string>();
  const chunks: RetrievedChunk[] = [];

  for (const chunk of [...explicitChunks, ...retrievedChunks]) {
    if (seen.has(chunk.id)) {
      continue;
    }
    chunks.push(chunk);
    seen.add(chunk.id);
    if (chunks.length >= limit) {
      break;
    }
  }

  return chunks;
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

function mergeEvidenceChunks(
  localChunks: RetrievedChunk[],
  webChunks: RetrievedChunk[],
  limit: number,
  preferWeb: boolean,
): RetrievedChunk[] {
  if (webChunks.length === 0) {
    return localChunks.slice(0, limit);
  }

  if (localChunks.length === 0) {
    return webChunks.slice(0, limit);
  }

  const webLimit = preferWeb
    ? Math.min(webChunks.length, Math.max(1, Math.ceil(limit / 2)))
    : Math.min(webChunks.length, Math.max(1, Math.floor(limit / 3)));
  const localLimit = Math.max(0, limit - webLimit);
  const primary = preferWeb ? webChunks.slice(0, webLimit) : localChunks.slice(0, localLimit);
  const secondary = preferWeb ? localChunks.slice(0, localLimit) : webChunks.slice(0, webLimit);

  return [...primary, ...secondary].slice(0, limit);
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
