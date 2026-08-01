import { ContextFileProvider } from "@application/ports";
import { Extractor } from "@application/ports/indexing";
import { RetrievalOptions } from "@core/retrieval";
import {
  ContextDiagnosticSource,
  ContextDiagnostics,
  ContextMode,
  ContextSourceRole,
} from "@core/diagnostics";
import { ExtractedChunk, RetrievedChunk } from "@core/model";

/** Injected content-hash function (e.g. extractors/common.stableId). Keeps the
 *  assembler free of any concrete (Node crypto) hashing dependency. */
export type GenerateId = (value: string) => string;
import {
  createDisabledGraphDiagnostics,
  DEFAULT_GRAPH_CONTEXT_LIMITS,
  GraphContextProvider,
  GraphContextLimits,
  GraphRoot,
} from "@core/research";
import {
  AttachedFileCoverage,
  AttachedFileManifestEntry,
  estimateTextTokens,
  ResearchChatHistoryMessage,
} from "@core/research";

export interface ContextAssemblerOptions {
  files: ContextFileProvider;
  extractors: Extractor[];
  graph?: GraphContextProvider;
  retrieve(
    query: string,
    options: RetrievalOptions,
  ): Promise<{ chunks: RetrievedChunk[]; queryVariants?: string[] } | RetrievedChunk[]>;
  generateId: GenerateId;
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
  skipRetrieval?: boolean;
  explicitSourcesOnly?: boolean;
  /**
   * Thinking runs with note tools: large attachments are not inlined as excerpts —
   * they stay tool-addressable references the model reads in full via read_note.
   * Small files (single markdown under the small-file limit) still inline whole.
   */
  largeAttachmentsAsReferences?: boolean;
  graph?: {
    enabled: boolean;
    includeBacklinks: boolean;
    expandFilteredContextThroughLinks: boolean;
    depth: 1 | 2;
    limits?: Partial<GraphContextLimits>;
  };
}

export interface AssembledContext {
  /** User-attached files with how their content was delivered — prompt manifest data. */
  attachments: AttachedFileManifestEntry[];
  explicitEvidence: RetrievedChunk[];
  retrievalEvidence: RetrievedChunk[];
  evidence: RetrievedChunk[];
  retrievalSourcePaths?: string[];
  boostedSourcePaths?: string[];
  graphSourcePaths: string[];
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
  private readonly graph?: GraphContextProvider;
  private readonly retrieve: ContextAssemblerOptions["retrieve"];
  private readonly generateId: GenerateId;

  constructor(options: ContextAssemblerOptions) {
    this.files = options.files;
    this.extractors = options.extractors;
    this.graph = options.graph;
    this.retrieve = options.retrieve;
    this.generateId = options.generateId;
  }

  async assemble(request: ContextAssembleRequest): Promise<AssembledContext> {
    const availablePaths = await this.files.listPaths();
    const mentionPaths = request.explicitSourcesOnly
      ? []
      : findMentionedPaths(request.question, availablePaths);
    const explicitCandidates = this.explicitCandidates(request, mentionPaths);
    const diagnostics = createEmptyDiagnostics(request.contextMode);
    const graph = request.explicitSourcesOnly
      ? {
          sourcePaths: [],
          diagnostics: createDisabledGraphDiagnostics({
            ...DEFAULT_GRAPH_CONTEXT_LIMITS,
            ...(request.graph?.limits ?? {}),
          }),
        }
      : await this.discoverGraphContext(request, availablePaths, mentionPaths);
    diagnostics.graph = graph.diagnostics;
    const budget = createBudget(request);
    const explicitEvidence: RetrievedChunk[] = [];
    const attachments: AttachedFileManifestEntry[] = [];
    let explicitTokens = 0;
    const recordAttachment = (candidate: ContextCandidate, coverage: AttachedFileCoverage) => {
      if (candidate.role === "attached") {
        attachments.push({ path: candidate.path, coverage });
      }
    };

    for (const candidate of explicitCandidates) {
      const sourceDiagnostic = await this.buildExplicitSource(
        candidate,
        request,
        budget.explicitTokens - explicitTokens,
      );
      addDiagnosticSource(diagnostics, sourceDiagnostic.diagnostic);

      if (sourceDiagnostic.chunks.length === 0) {
        recordAttachment(
          candidate,
          sourceDiagnostic.coverage === "reference" ? "reference" : "omitted",
        );
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
        recordAttachment(candidate, "omitted");
        continue;
      }

      if (explicitTokens + candidateTokens > budget.explicitTokens) {
        addDiagnosticSource(diagnostics, {
          ...sourceDiagnostic.diagnostic,
          status: "dropped",
          reason: "context-budget-exceeded",
          droppedTokens: candidateTokens,
        });
        recordAttachment(candidate, "omitted");
        continue;
      }

      explicitEvidence.push(...chunksToAdd);
      explicitTokens += candidateTokens;
      recordAttachment(
        candidate,
        chunksToAdd.length === sourceDiagnostic.chunks.length &&
          sourceDiagnostic.coverage === "full"
          ? "full"
          : "excerpts",
      );
    }

    const retrievalSourcePaths = this.retrievalSourcePaths(
      request,
      mentionPaths,
      graph.sourcePaths,
    );
    const boostedSourcePaths =
      request.contextMode === "filter" ? [] : uniquePaths(graph.sourcePaths);
    const retrievalResult = request.skipRetrieval
      ? []
      : await this.retrieve(request.question, {
          limit: request.evidenceLimit,
          includeWebResults: false,
          ...(retrievalSourcePaths.length > 0 ? { sourcePaths: retrievalSourcePaths } : {}),
          ...(boostedSourcePaths.length > 0 ? { boostedSourcePaths } : {}),
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
          name: "graph",
          usedTokens: 0,
          droppedItems: diagnostics.graph.dropped.length,
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
      attachments,
      explicitEvidence,
      retrievalEvidence,
      evidence: [...explicitEvidence, ...retrievalEvidence],
      retrievalSourcePaths: retrievalSourcePaths.length > 0 ? retrievalSourcePaths : undefined,
      boostedSourcePaths: boostedSourcePaths.length > 0 ? boostedSourcePaths : undefined,
      graphSourcePaths: graph.sourcePaths,
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

    for (const path of request.contextPaths) {
      add(path, "attached");
    }

    if (request.includeActiveFile) {
      add(request.activeFilePath, "active");
    }

    return candidates;
  }

  private retrievalSourcePaths(
    request: ContextAssembleRequest,
    mentionPaths: string[],
    graphSourcePaths: string[],
  ): string[] {
    if (request.contextMode !== "filter") {
      return [];
    }

    return uniquePaths([
      ...request.contextPaths,
      ...mentionPaths,
      ...(request.graph?.expandFilteredContextThroughLinks ? graphSourcePaths : []),
    ]);
  }

  private async discoverGraphContext(
    request: ContextAssembleRequest,
    availablePaths: string[],
    mentionPaths: string[],
  ): Promise<{ sourcePaths: string[]; diagnostics: ContextDiagnostics["graph"] }> {
    const graphOptions = request.graph;
    const limits = { ...DEFAULT_GRAPH_CONTEXT_LIMITS, ...(graphOptions?.limits ?? {}) };

    if (!this.graph || graphOptions?.enabled !== true) {
      return { sourcePaths: [], diagnostics: createDisabledGraphDiagnostics(limits) };
    }

    const roots = this.graphRoots(request, mentionPaths);
    const discovery = await this.graph.discover({
      question: request.question,
      roots,
      availablePaths,
      includeBacklinks: graphOptions.includeBacklinks,
      maxDepth: graphOptions.depth,
      limits,
    });

    return {
      sourcePaths: discovery.sourcePaths,
      diagnostics: discovery.diagnostics,
    };
  }

  private graphRoots(request: ContextAssembleRequest, mentionPaths: string[]): GraphRoot[] {
    const roots: GraphRoot[] = [];
    const add = (path: string | undefined, role: ContextSourceRole): void => {
      if (!path || roots.some((root) => root.path === path)) {
        return;
      }

      roots.push({ path, role });
    };

    for (const path of mentionPaths) {
      add(path, "mention");
    }

    if (request.includeActiveFile) {
      add(request.activeFilePath, "active");
    }

    if (request.contextMode === "include" || request.graph?.expandFilteredContextThroughLinks) {
      for (const path of request.contextPaths) {
        add(path, "attached");
      }
    }

    return roots;
  }

  private async buildExplicitSource(
    candidate: ContextCandidate,
    request: ContextAssembleRequest,
    remainingTokens: number,
  ): Promise<{
    chunks: RetrievedChunk[];
    diagnostic: ContextDiagnosticSource;
    coverage: AttachedFileCoverage;
  }> {
    const extractor = this.extractors.find((item) => item.supports(candidate.path));

    if (!extractor) {
      return {
        chunks: [],
        coverage: "omitted",
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
        coverage: "omitted",
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
      const size = await this.files.getSize?.(candidate.path);
      const chunks = await extractor.extract({
        path: candidate.path,
        data,
        modifiedTime,
        size,
      });
      const selected = selectExplicitChunks(chunks, request, remainingTokens, this.generateId);

      if (selected.coverage === "reference") {
        return {
          chunks: [],
          coverage: "reference",
          diagnostic: {
            path: candidate.path,
            role: candidate.role,
            status: "dropped",
            reason: "referenced-for-tools",
            droppedTokens: estimateChunksTokens(chunks),
          },
        };
      }

      return {
        chunks: selected.chunks,
        coverage: selected.coverage,
        diagnostic: {
          path: candidate.path,
          role: candidate.role,
          status: selected.chunks.length > 0 ? "included" : "dropped",
          chunkCount: selected.chunks.length,
          includedTokens: estimateChunksTokens(selected.chunks),
          droppedTokens: Math.max(
            0,
            estimateChunksTokens(chunks) - estimateChunksTokens(selected.chunks),
          ),
          reason: selected.chunks.length > 0 ? undefined : "context-budget-exceeded",
        },
      };
    } catch {
      return {
        chunks: [],
        coverage: "omitted",
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
  generateId: GenerateId,
): { chunks: RetrievedChunk[]; coverage: AttachedFileCoverage } {
  if (chunks.length === 0 || remainingTokens <= 0) {
    return { chunks: [], coverage: "omitted" };
  }

  if (isSingleSmallMarkdownFile(chunks, request.smallMarkdownCharLimit)) {
    const combined = combineMarkdownChunks(chunks, generateId);

    if (estimateTextTokens(combined.text) <= remainingTokens) {
      return { chunks: [combined], coverage: "full" };
    }
  }

  if (request.largeAttachmentsAsReferences) {
    return { chunks: [], coverage: "reference" };
  }

  const ranked = rankChunksForQuestion(chunks, request.question);
  const packed = packChunksByBudget(ranked, remainingTokens);
  return {
    chunks: packed,
    coverage: packed.length === chunks.length ? "full" : "excerpts",
  };
}

function isSingleSmallMarkdownFile(
  chunks: ExtractedChunk[],
  smallMarkdownCharLimit?: number,
): boolean {
  if (!chunks.every((chunk) => chunk.source.kind === "markdown")) {
    return false;
  }

  return (
    chunks.reduce((total, chunk) => total + chunk.text.length, 0) <=
    (smallMarkdownCharLimit ?? DEFAULT_SMALL_MARKDOWN_CHAR_LIMIT)
  );
}

function combineMarkdownChunks(chunks: ExtractedChunk[], generateId: GenerateId): RetrievedChunk {
  const first = chunks[0];
  const text = chunks.map((chunk) => chunk.text).join("\n\n");
  const contentHash = generateId(text);
  const source =
    first.source.kind === "markdown"
      ? {
          ...first.source,
          id: generateId(`${first.source.path}:explicit-full:${contentHash}`),
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
  const termPatterns = question
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3)
    .map((term) => new RegExp(`\\b${escapeRegExp(term)}`, "u"));

  return chunks
    .map((chunk, index) => {
      const sourceText =
        chunk.source.kind === "markdown"
          ? `${chunk.source.path} ${chunk.source.headingPath.join(" ")} ${chunk.text}`
          : `${"path" in chunk.source ? chunk.source.path : chunk.source.title} ${chunk.text}`;
      const haystack = sourceText.toLowerCase();
      const score =
        termPatterns.reduce((total, pattern) => total + (pattern.test(haystack) ? 1 : 0), 0) +
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
    graph: createDisabledGraphDiagnostics(),
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

function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths.filter(Boolean)));
}
