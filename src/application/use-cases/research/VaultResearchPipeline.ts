import { RetrievalResult } from "@application/contracts";
import { QueryExpansion } from "@application/contracts/research";
import { uniqueChunks } from "@core/model";
import { RetrievalQueryVariant } from "@core/retrieval";
import { ResearchRetriever, ResearchStreamEvent } from "@application/contracts/research";

export interface VaultResearchPipelineOptions {
  retriever: ResearchRetriever;
  queryExpansion?: QueryExpansion;
  evidenceLimit: number;
}

export class VaultResearchPipeline {
  private readonly retriever: ResearchRetriever;
  private readonly queryExpansion?: QueryExpansion;
  private readonly evidenceLimit: number;

  constructor(options: VaultResearchPipelineOptions) {
    this.retriever = options.retriever;
    this.queryExpansion = options.queryExpansion;
    this.evidenceLimit = options.evidenceLimit;
  }

  async *search(
    question: string,
    contextPaths: string[] | undefined,
    boostedSourcePaths: string[] | undefined = undefined,
  ): AsyncGenerator<ResearchStreamEvent, RetrievalResult> {
    yield { type: "status", message: "Reading vault context..." };
    const queryVariants = yield* this.buildQueryVariants(question);
    const primary = await this.retriever.search(question, {
      limit: this.evidenceLimit,
      includeWebResults: false,
      queryVariants,
      ...(contextPaths ? { sourcePaths: contextPaths } : {}),
    });

    if (!boostedSourcePaths || boostedSourcePaths.length === 0) {
      return { ...primary, queryVariants };
    }

    yield { type: "status", message: "Searching linked notes..." };
    const graph = await this.retriever.search(question, {
      limit: this.evidenceLimit,
      includeWebResults: false,
      queryVariants,
      sourcePaths: boostedSourcePaths,
    });

    return { ...mergeRetrievalResults(primary, graph, this.evidenceLimit), queryVariants };
  }

  private async *buildQueryVariants(
    question: string,
  ): AsyncGenerator<ResearchStreamEvent, RetrievalQueryVariant[] | undefined> {
    if (!this.queryExpansion || !this.retriever.getLanguageInventory) {
      return undefined;
    }

    const languageInventory = await this.retriever.getLanguageInventory();

    if (languageInventory.length === 0) {
      return undefined;
    }

    yield { type: "status", message: "Expanding search queries..." };
    const variants = await this.queryExpansion.buildVariants({
      query: question,
      languageInventory,
    });

    return variants.length > 0 ? variants : undefined;
  }
}

function mergeRetrievalResults(
  primary: RetrievalResult,
  graph: RetrievalResult,
  limit: number,
): RetrievalResult {
  const graphLimit = Math.min(graph.chunks.length, Math.max(1, Math.ceil(limit * 0.25)));
  const chunks = uniqueChunks([
    ...graph.chunks.slice(0, graphLimit),
    ...primary.chunks,
    ...graph.chunks.slice(graphLimit),
  ]).slice(0, limit);
  const citationIds = new Set(chunks.map((chunk) => chunk.id));
  const citations = uniqueCitations([...graph.citations, ...primary.citations]).filter((citation) =>
    citationIds.has(citation.id),
  );

  return {
    chunks,
    citations,
    usedFallback: primary.usedFallback && graph.usedFallback,
  };
}

function uniqueCitations(citations: RetrievalResult["citations"]): RetrievalResult["citations"] {
  const seen = new Set<string>();
  const unique: RetrievalResult["citations"] = [];

  for (const citation of citations) {
    if (seen.has(citation.id)) {
      continue;
    }

    seen.add(citation.id);
    unique.push(citation);
  }

  return unique;
}
