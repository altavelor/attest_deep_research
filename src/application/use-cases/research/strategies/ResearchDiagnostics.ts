import { RetrievalResult } from "@application/contracts";
import {
  ContextDiagnostics,
  ContextMode,
  ResearchExecutionStrategy,
  WebContextDiagnostics,
} from "@core/diagnostics";
import { RetrievedChunk } from "@core/model";
import { estimateTextTokens } from "@core/research";

export function withRetrievalDiagnostics(
  diagnostics: ContextDiagnostics,
  retrieval: RetrievalResult,
): ContextDiagnostics {
  const rankedChunks = retrieval.chunks.map((chunk, index) => {
    const path = "path" in chunk.source ? chunk.source.path : chunk.source.title;
    return {
      id: chunk.id,
      path,
      rank: index + 1,
      score: chunk.score,
      status: "included" as const,
    };
  });
  return {
    ...diagnostics,
    retrieval: {
      ...diagnostics.retrieval,
      queryVariants: (retrieval.queryVariants ?? []).map((variant) => variant.query),
      includedChunkIds: retrieval.chunks.map((chunk) => chunk.id),
      droppedChunkIds: [],
      rankedChunks,
    },
  };
}

export function withPlannerDiagnostics(
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

export function withWebDiagnostics(
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

export function createEmptyContextDiagnostics(
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

/**
 * One report-level warning when index retrieval degraded to keyword-only
 * ranking (semantic path failed). Agentic runs surface it via search_index
 * ToolCallDiagnostic.metadata; eager runs via RetrievalResult.semanticError.
 */
export function semanticDegradationWarning(
  sources: Array<{ semanticError?: string }>,
): string | undefined {
  const errors = [
    ...new Set(sources.map((source) => source.semanticError).filter(Boolean)),
  ] as string[];
  if (errors.length === 0) {
    return undefined;
  }
  return `Index search degraded to keyword-only ranking: semantic (embedding) search failed — ${errors.join("; ")}`;
}

export function agenticBudgets(usedResultChars: number, maxResultChars: number) {
  return {
    maxRounds: 30,
    maxResultChars,
    usedResultChars,
  };
}

export function isRagDebugIntent(question: string): boolean {
  return /(rag|retrieval|чанк|почему[^?]*(?:не наш|плох)|диагностик)/i.test(question);
}

export function buildRagDiagnosticSnapshot(diagnostics: ContextDiagnostics): string {
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
