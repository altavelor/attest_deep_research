import { RetrievalResult } from "../retrieval/RetrievalService";
import { formatCitation } from "../retrieval/citations";
import {
  ChatModelProvider,
  Citation,
  ResearchAnswer,
  RetrievedChunk,
  RetrievalOptions,
  SearchProvider,
} from "../shared/types";
import { buildResearchPrompt, extractFollowUpQuestions } from "./prompts";

export interface ResearchRetriever {
  search(query: string, options: RetrievalOptions): Promise<RetrievalResult>;
}

export type ResearchSearchMode = "indexOnly" | "indexAndWeb" | "webOnly";

export interface ResearchRequest {
  question: string;
  includeWebSearch?: boolean;
  searchMode?: ResearchSearchMode;
  contextPaths?: string[];
}

export type ResearchStreamEvent =
  | { type: "delta"; content: string }
  | { type: "complete"; answer: ResearchAnswer };

export interface ResearchServiceOptions {
  retriever: ResearchRetriever;
  chatModel: ChatModelProvider;
  chatModelName: string;
  searchProvider?: SearchProvider;
  evidenceLimit?: number;
  temperature?: number;
  now?: () => Date;
  persistFinalAnswer?: (answer: ResearchAnswer) => void | Promise<void>;
}

const DEFAULT_EVIDENCE_LIMIT = 8;
const DEFAULT_TEMPERATURE = 0.2;

export class ResearchService {
  private readonly retriever: ResearchRetriever;
  private readonly chatModel: ChatModelProvider;
  private readonly chatModelName: string;
  private readonly searchProvider?: SearchProvider;
  private readonly evidenceLimit: number;
  private readonly temperature: number;
  private readonly now: () => Date;
  private readonly persistFinalAnswer?: (answer: ResearchAnswer) => void | Promise<void>;

  constructor(options: ResearchServiceOptions) {
    this.retriever = options.retriever;
    this.chatModel = options.chatModel;
    this.chatModelName = options.chatModelName;
    this.searchProvider = options.searchProvider;
    this.evidenceLimit = options.evidenceLimit ?? DEFAULT_EVIDENCE_LIMIT;
    this.temperature = options.temperature ?? DEFAULT_TEMPERATURE;
    this.now = options.now ?? (() => new Date());
    this.persistFinalAnswer = options.persistFinalAnswer;
  }

  async *answer(request: ResearchRequest): AsyncIterable<ResearchStreamEvent> {
    const question = request.question.trim();
    const searchMode = resolveSearchMode(request);
    const retrieval =
      searchMode === "webOnly"
        ? emptyRetrievalResult()
        : await this.retriever.search(question, {
            limit: this.evidenceLimit,
            includeWebResults: false,
            sourcePaths: request.contextPaths,
          });
    const webEvidence = await this.searchWebEvidence(question, searchMode !== "indexOnly");
    const evidence = [...retrieval.chunks, ...webEvidence.chunks].slice(0, this.evidenceLimit);
    const citations = mergeCitations(retrieval.citations, webEvidence.citations);
    const prompt = buildResearchPrompt({
      question,
      evidence,
      maxEvidenceItems: this.evidenceLimit,
    });
    let answerText = "";

    for await (const chunk of this.chatModel.streamChat({
      model: this.chatModelName,
      temperature: this.temperature,
      messages: [
        {
          role: "system",
          content:
            "You are Ixplorer, a local-first Obsidian research assistant. Answer only from provided evidence and preserve citation IDs.",
        },
        { role: "user", content: prompt },
      ],
    })) {
      if (chunk.content) {
        answerText += chunk.content;
        yield { type: "delta", content: chunk.content };
      }

      if (chunk.isComplete) {
        break;
      }
    }

    const finalAnswer: ResearchAnswer = {
      question,
      answer: answerText,
      citations,
      evidence,
      followUpQuestions: extractFollowUpQuestions(answerText),
      createdAt: this.now().toISOString(),
    };

    if (this.persistFinalAnswer) {
      await this.persistFinalAnswer(finalAnswer);
    }

    yield { type: "complete", answer: finalAnswer };
  }

  private async searchWebEvidence(
    question: string,
    includeWebSearch: boolean,
  ): Promise<{ chunks: RetrievedChunk[]; citations: Citation[] }> {
    if (!includeWebSearch || !this.searchProvider) {
      return { chunks: [], citations: [] };
    }

    const result = await this.searchProvider.searchFirstResult(question);

    if (!result) {
      return { chunks: [], citations: [] };
    }

    const text = result.extractedText ?? result.source.snippet;
    const chunk: RetrievedChunk = {
      id: result.source.id,
      source: result.source,
      text,
      score: 0,
      contentHash: `web:${result.source.url}`,
    };

    return {
      chunks: [chunk],
      citations: [{ ...formatCitation(result.source), id: chunk.id }],
    };
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
