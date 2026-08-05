import { ContextFileProvider } from "@application/ports";
import { Extractor } from "@application/ports/indexing";
import {
  ContextDiagnosticSource,
  ContextDiagnostics,
  ContextMode,
  ContextSourceRole,
} from "@core/diagnostics";
import { RetrievedChunk } from "@core/model";

export type GenerateId = (value: string) => string;
import {
  createDisabledGraphDiagnostics,
  DEFAULT_GRAPH_CONTEXT_LIMITS,
  GraphContextProvider,
  GraphContextLimits,
} from "@core/research";
import {
  AttachedFileCoverage,
  AttachedFileManifestEntry,
  ResearchChatHistoryMessage,
} from "@core/research";
import { createContextBudget, estimateChunksTokens, estimateHistoryTokens } from "./contextBudget";
import { ExplicitContextSourceBuilder } from "./ExplicitContextSourceBuilder";
import { ContextGraphDiscovery } from "./ContextGraphDiscovery";

export interface ContextAssemblerOptions {
  files: ContextFileProvider;
  extractors: Extractor[];
  graph?: GraphContextProvider;
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
  explicitSourcesOnly?: boolean;

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
  attachments: AttachedFileManifestEntry[];
  explicitEvidence: RetrievedChunk[];
  retrievalSourcePaths?: string[];
  boostedSourcePaths?: string[];
  graphSourcePaths: string[];
  diagnostics: ContextDiagnostics;
}

interface ContextCandidate {
  path: string;
  role: ContextSourceRole;
}

export class ContextAssembler {
  private readonly files: ContextFileProvider;
  private readonly extractors: Extractor[];
  private readonly graph?: GraphContextProvider;
  private readonly generateId: GenerateId;
  private readonly explicitSourceBuilder: ExplicitContextSourceBuilder;
  private readonly graphDiscovery: ContextGraphDiscovery;

  constructor(options: ContextAssemblerOptions) {
    this.files = options.files;
    this.extractors = options.extractors;
    this.graph = options.graph;
    this.generateId = options.generateId;
    this.explicitSourceBuilder = new ExplicitContextSourceBuilder(
      this.files,
      this.extractors,
      this.generateId,
    );
    this.graphDiscovery = new ContextGraphDiscovery(this.graph);
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
      : await this.graphDiscovery.discover(request, availablePaths, mentionPaths);
    diagnostics.graph = graph.diagnostics;
    const budget = createContextBudget(request);
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
    diagnostics.retrieval = {
      queryVariants: [],
      includedChunkIds: [],
      droppedChunkIds: [],
      filteredSourcePaths: retrievalSourcePaths,
    };
    diagnostics.budget = {
      limitTokens: request.contextLimitTokens,
      reservedOutputTokens: request.reservedOutputTokens,
      usedTokens: explicitTokens,
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
          usedTokens: 0,
          droppedItems: 0,
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

  private async buildExplicitSource(
    candidate: ContextCandidate,
    request: ContextAssembleRequest,
    remainingTokens: number,
  ): Promise<{
    chunks: RetrievedChunk[];
    diagnostic: ContextDiagnosticSource;
    coverage: AttachedFileCoverage;
  }> {
    return this.explicitSourceBuilder.build(candidate, request, remainingTokens);
  }
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
