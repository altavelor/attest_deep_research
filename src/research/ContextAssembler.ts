import { stableId } from "../extractors/common";
import {
  ContextDiagnosticSource,
  ContextDiagnostics,
  ContextMode,
  ContextSourceRole,
  ExtractedChunk,
  Extractor,
  RetrievedChunk,
  RetrievalOptions,
} from "../shared/types";
import { estimateTextTokens, ResearchChatHistoryMessage } from "./prompts";

export interface ContextFileProvider {
  listPaths(): Promise<string[]>;
  readFile(path: string): Promise<ArrayBuffer | string>;
  getModifiedTime?(path: string): Promise<number>;
}

export interface ContextAssemblerOptions {
  files: ContextFileProvider;
  extractors: Extractor[];
  retrieve(
    query: string,
    options: RetrievalOptions,
  ): Promise<{ chunks: RetrievedChunk[]; queryVariants?: string[] } | RetrievedChunk[]>;
}

export interface ContextAssembleRequest {
  question: string;
  contextMode: ContextMode;
  contextPaths: string[];
  evidenceLimit: number;
  activeFilePath?: string;
  includeActiveFile?: boolean;
  chatHistory?: ResearchChatHistoryMessage[];
  contextLimitTokens?: number;
  reservedOutputTokens?: number;
  smallMarkdownCharLimit?: number;
}

export interface AssembledContext {
  explicitEvidence: RetrievedChunk[];
  retrievalEvidence: RetrievedChunk[];
  evidence: RetrievedChunk[];
  retrievalSourcePaths?: string[];
  diagnostics: ContextDiagnostics;
}

interface ContextCandidate {
  path: string;
  role: ContextSourceRole;
}

const DEFAULT_SMALL_MARKDOWN_CHAR_LIMIT = 10_000;
const DEFAULT_EXPLICIT_CONTEXT_WINDOW_SHARE = 0.45;
const DEFAULT_RETRIEVAL_CONTEXT_WINDOW_SHARE = 0.35;
const FALLBACK_TOKENS_PER_EVIDENCE_ITEM = 500;

export class ContextAssembler {
  private readonly files: ContextFileProvider;
  private readonly extractors: Extractor[];
  private readonly retrieve: ContextAssemblerOptions["retrieve"];

  constructor(options: ContextAssemblerOptions) {
    this.files = options.files;
    this.extractors = options.extractors;
    this.retrieve = options.retrieve;
  }

  async assemble(request: ContextAssembleRequest): Promise<AssembledContext> {
    const availablePaths = await this.files.listPaths();
    const mentionPaths = findMentionedPaths(request.question, availablePaths);
    const explicitCandidates = this.explicitCandidates(request, mentionPaths);
    const diagnostics = createEmptyDiagnostics(request.contextMode);
    for (const path of request.contextMode === "filter" ? request.contextPaths : []) {
      addDiagnosticSource(diagnostics, {
        path,
        role: "attached",
        status: "filtered",
        reason: "retrieval-filter",
      });
    }
    const budget = createBudget(request);
    const explicitEvidence: RetrievedChunk[] = [];
    let explicitTokens = 0;

    for (const candidate of explicitCandidates) {
      const sourceDiagnostic = await this.buildExplicitSource(
        candidate,
        request,
        budget.explicitTokens - explicitTokens,
      );
      addDiagnosticSource(diagnostics, sourceDiagnostic.diagnostic);

      if (sourceDiagnostic.chunks.length === 0) {
        continue;
      }

      const remainingItems = Math.max(0, request.evidenceLimit - explicitEvidence.length);
      const chunksToAdd = sourceDiagnostic.chunks.slice(0, remainingItems);
      const candidateTokens = estimateChunksTokens(chunksToAdd);
      if (chunksToAdd.length === 0) {
        addDiagnosticSource(diagnostics, {
          ...sourceDiagnostic.diagnostic,
          status: "dropped",
          reason: "evidence-limit-exceeded",
          droppedTokens: estimateChunksTokens(sourceDiagnostic.chunks),
        });
        continue;
      }

      if (explicitTokens + candidateTokens > budget.explicitTokens) {
        addDiagnosticSource(diagnostics, {
          ...sourceDiagnostic.diagnostic,
          status: "dropped",
          reason: "context-budget-exceeded",
          droppedTokens: candidateTokens,
        });
        continue;
      }

      explicitEvidence.push(...chunksToAdd);
      explicitTokens += candidateTokens;
    }

    const retrievalSourcePaths = this.retrievalSourcePaths(request, mentionPaths);
    const retrievalResult = await this.retrieve(request.question, {
      limit: request.evidenceLimit,
      includeWebResults: false,
      ...(retrievalSourcePaths.length > 0 ? { sourcePaths: retrievalSourcePaths } : {}),
    });
    const retrievalChunks = Array.isArray(retrievalResult)
      ? retrievalResult
      : retrievalResult.chunks;
    const retrievalEvidence = packChunksByBudget(retrievalChunks, budget.retrievalTokens);
    const droppedRetrieval = retrievalChunks.slice(retrievalEvidence.length);

    diagnostics.retrieval = {
      queryVariants: Array.isArray(retrievalResult) ? [] : (retrievalResult.queryVariants ?? []),
      includedChunkIds: retrievalEvidence.map((chunk) => chunk.id),
      droppedChunkIds: droppedRetrieval.map((chunk) => chunk.id),
      filteredSourcePaths: retrievalSourcePaths,
    };
    diagnostics.budget = {
      limitTokens: request.contextLimitTokens,
      reservedOutputTokens: request.reservedOutputTokens,
      usedTokens: explicitTokens + estimateChunksTokens(retrievalEvidence),
      groups: [
        {
          name: "history",
          usedTokens: estimateHistoryTokens(request.chatHistory ?? []),
          droppedItems: 0,
        },
        {
          name: "explicit",
          usedTokens: explicitTokens,
          droppedItems: diagnostics.explicitSources.filter((source) => source.status === "dropped")
            .length,
        },
        {
          name: "retrieval",
          usedTokens: estimateChunksTokens(retrievalEvidence),
          droppedItems: droppedRetrieval.length,
        },
        {
          name: "reserved-output",
          usedTokens: request.reservedOutputTokens ?? 0,
          droppedItems: 0,
        },
      ],
    };

    return {
      explicitEvidence,
      retrievalEvidence,
      evidence: [...explicitEvidence, ...retrievalEvidence],
      retrievalSourcePaths: retrievalSourcePaths.length > 0 ? retrievalSourcePaths : undefined,
      diagnostics,
    };
  }

  private explicitCandidates(
    request: ContextAssembleRequest,
    mentionPaths: string[],
  ): ContextCandidate[] {
    const candidates: ContextCandidate[] = [];
    const seen = new Set<string>();
    const add = (path: string | undefined, role: ContextSourceRole): void => {
      if (!path || seen.has(path)) {
        return;
      }
      seen.add(path);
      candidates.push({ path, role });
    };

    for (const path of mentionPaths) {
      add(path, "mention");
    }

    if (request.includeActiveFile) {
      add(request.activeFilePath, "active");
    }

    if (request.contextMode === "include") {
      for (const path of request.contextPaths) {
        add(path, "attached");
      }
    }

    return candidates;
  }

  private retrievalSourcePaths(request: ContextAssembleRequest, mentionPaths: string[]): string[] {
    if (request.contextMode !== "filter") {
      return [];
    }

    return Array.from(new Set([...request.contextPaths, ...mentionPaths]));
  }

  private async buildExplicitSource(
    candidate: ContextCandidate,
    request: ContextAssembleRequest,
    remainingTokens: number,
  ): Promise<{ chunks: RetrievedChunk[]; diagnostic: ContextDiagnosticSource }> {
    const extractor = this.extractors.find((item) => item.supports(candidate.path));

    if (!extractor) {
      return {
        chunks: [],
        diagnostic: {
          path: candidate.path,
          role: candidate.role,
          status: "unsupported",
          reason: "unsupported-file-type",
        },
      };
    }

    let data: ArrayBuffer | string;
    try {
      data = await this.files.readFile(candidate.path);
    } catch {
      return {
        chunks: [],
        diagnostic: {
          path: candidate.path,
          role: candidate.role,
          status: "missing",
          reason: "read-failed",
        },
      };
    }

    try {
      const modifiedTime = (await this.files.getModifiedTime?.(candidate.path)) ?? 0;
      const chunks = await extractor.extract({
        path: candidate.path,
        data,
        modifiedTime,
      });
      const selectedChunks = selectExplicitChunks(chunks, request, remainingTokens);

      return {
        chunks: selectedChunks,
        diagnostic: {
          path: candidate.path,
          role: candidate.role,
          status: selectedChunks.length > 0 ? "included" : "dropped",
          chunkCount: selectedChunks.length,
          includedTokens: estimateChunksTokens(selectedChunks),
          droppedTokens: Math.max(0, estimateChunksTokens(chunks) - estimateChunksTokens(selectedChunks)),
          reason: selectedChunks.length > 0 ? undefined : "context-budget-exceeded",
        },
      };
    } catch {
      return {
        chunks: [],
        diagnostic: {
          path: candidate.path,
          role: candidate.role,
          status: "failed",
          reason: "extraction-failed",
        },
      };
    }
  }
}

function createBudget(request: ContextAssembleRequest): {
  explicitTokens: number;
  retrievalTokens: number;
} {
  if (!request.contextLimitTokens) {
    const fallback = Math.max(1, request.evidenceLimit) * FALLBACK_TOKENS_PER_EVIDENCE_ITEM;
    return {
      explicitTokens: fallback,
      retrievalTokens: fallback,
    };
  }

  const reserved = request.reservedOutputTokens ?? 0;
  const historyTokens = estimateHistoryTokens(request.chatHistory ?? []);
  const available = Math.max(0, request.contextLimitTokens - reserved - historyTokens);

  return {
    explicitTokens: Math.max(0, Math.floor(available * DEFAULT_EXPLICIT_CONTEXT_WINDOW_SHARE)),
    retrievalTokens: Math.max(0, Math.floor(available * DEFAULT_RETRIEVAL_CONTEXT_WINDOW_SHARE)),
  };
}

function selectExplicitChunks(
  chunks: ExtractedChunk[],
  request: ContextAssembleRequest,
  remainingTokens: number,
): RetrievedChunk[] {
  if (chunks.length === 0 || remainingTokens <= 0) {
    return [];
  }

  if (isSingleSmallMarkdownFile(chunks, request.smallMarkdownCharLimit)) {
    const combined = combineMarkdownChunks(chunks);

    if (estimateTextTokens(combined.text) <= remainingTokens) {
      return [combined];
    }
  }

  const ranked = rankChunksForQuestion(chunks, request.question);
  return packChunksByBudget(ranked, remainingTokens);
}

function isSingleSmallMarkdownFile(chunks: ExtractedChunk[], smallMarkdownCharLimit?: number): boolean {
  if (!chunks.every((chunk) => chunk.source.kind === "markdown")) {
    return false;
  }

  return chunks.reduce((total, chunk) => total + chunk.text.length, 0) <=
    (smallMarkdownCharLimit ?? DEFAULT_SMALL_MARKDOWN_CHAR_LIMIT);
}

function combineMarkdownChunks(chunks: ExtractedChunk[]): RetrievedChunk {
  const first = chunks[0];
  const text = chunks.map((chunk) => chunk.text).join("\n\n");
  const contentHash = stableId(text);
  const source =
    first.source.kind === "markdown"
      ? {
          ...first.source,
          id: stableId(`${first.source.path}:explicit-full:${contentHash}`),
          title: first.source.path,
          headingPath: [],
          startOffset: undefined,
          endOffset: undefined,
          blockId: undefined,
        }
      : first.source;

  return {
    id: source.id,
    source,
    text,
    contentHash,
    score: 1,
  };
}

function rankChunksForQuestion(chunks: ExtractedChunk[], question: string): RetrievedChunk[] {
  const terms = question
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3);

  return chunks
    .map((chunk, index) => {
      const sourceText =
        chunk.source.kind === "markdown"
          ? `${chunk.source.path} ${chunk.source.headingPath.join(" ")} ${chunk.text}`
          : `${"path" in chunk.source ? chunk.source.path : chunk.source.title} ${chunk.text}`;
      const haystack = sourceText.toLowerCase();
      const score =
        terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0) +
        1 / (index + 1_000);

      return { ...chunk, score };
    })
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
}

function packChunksByBudget<T extends RetrievedChunk>(chunks: T[], budgetTokens: number): T[] {
  const packed: T[] = [];
  let usedTokens = 0;

  for (const chunk of chunks) {
    const tokens = estimateTextTokens(chunk.text);

    if (usedTokens + tokens > budgetTokens) {
      continue;
    }

    packed.push(chunk);
    usedTokens += tokens;
  }

  return packed;
}

function estimateChunksTokens(chunks: Array<{ text: string }>): number {
  return chunks.reduce((total, chunk) => total + estimateTextTokens(chunk.text), 0);
}

function estimateHistoryTokens(history: ResearchChatHistoryMessage[]): number {
  return history.reduce((total, message) => total + estimateTextTokens(message.content), 0);
}

function createEmptyDiagnostics(contextMode: ContextMode): ContextDiagnostics {
  return {
    contextMode,
    explicitSources: [],
    mentionSources: [],
    activeSources: [],
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
    warnings: [],
  };
}

function addDiagnosticSource(
  diagnostics: ContextDiagnostics,
  source: ContextDiagnosticSource,
): void {
  if (source.role === "mention") {
    diagnostics.mentionSources.push(source);
    return;
  }

  if (source.role === "active") {
    diagnostics.activeSources.push(source);
    return;
  }

  diagnostics.explicitSources.push(source);
}

function findMentionedPaths(text: string, paths: string[]): string[] {
  const sortedPaths = [...paths].sort((left, right) => right.length - left.length);
  const matches: Array<{ path: string; start: number; end: number }> = [];

  for (const path of sortedPaths) {
    const literal = `@${escapeRegExp(path)}`;
    const pattern = new RegExp(`${literal}(?=\\s|@|$)`, "g");
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;

      if (matches.some((existing) => !(end <= existing.start || start >= existing.end))) {
        continue;
      }

      matches.push({ path, start, end });
    }
  }

  return matches.sort((left, right) => left.start - right.start).map((match) => match.path);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
