import { RetrievalResult } from "../retrieval/RetrievalService";
import { QueryExpansionService } from "../retrieval/QueryExpansionService";
import {
  ChatModelProvider,
  Citation,
  ResearchAnswer,
  RetrievedChunk,
  SearchProvider,
} from "../shared/types";
import { AnswerSynthesisService } from "./AnswerSynthesisService";
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
  searchProvider?: SearchProvider;
  queryExpansion?: QueryExpansionService;
  evidenceLimit?: number;
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

  constructor(options: ResearchServiceOptions) {
    this.evidenceLimit = options.evidenceLimit ?? DEFAULT_EVIDENCE_LIMIT;
    const temperature = options.temperature ?? DEFAULT_TEMPERATURE;
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
      evidenceLimit: this.evidenceLimit,
    });
    this.answerSynthesis = new AnswerSynthesisService({
      chatModel: options.chatModel,
      chatModelName: options.chatModelName,
      temperature,
      now,
      persistFinalAnswer: options.persistFinalAnswer,
    });
  }

  async *answer(request: ResearchRequest): AsyncIterable<ResearchStreamEvent> {
    const question = request.question.trim();
    const searchMode = resolveSearchMode(request);
    const deepResearch = request.deepResearch === true;
    const retrieval =
      searchMode === "webOnly"
        ? emptyRetrievalResult()
        : yield* this.vaultPipeline.search(question, request.contextPaths);
    const webEvidence = yield* this.webPipeline.search(
      question,
      searchMode !== "indexOnly",
      deepResearch,
    );
    const evidence = mergeEvidenceChunks(
      retrieval.chunks,
      webEvidence.chunks,
      this.evidenceLimit,
      deepResearch,
    );
    const citations = mergeCitations(retrieval.citations, webEvidence.citations);

    yield* this.answerSynthesis.synthesize({
      question,
      evidence,
      citations,
      evidenceLimit: this.evidenceLimit,
    });
  }
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
