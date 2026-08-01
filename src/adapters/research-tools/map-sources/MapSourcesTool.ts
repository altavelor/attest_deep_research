import { MAP_SOURCES_TOOL, toolFailure } from "@core/agent";
import { SUB_AGENT_PHASE } from "@application/research";
import { MapSources, MapSourceRow } from "@application/use-cases/map-sources";
import { EvidenceRegistry } from "@application/sources";
import { defineTool, int, str, strArray } from "@application/sources/tools";

export interface MapSourcesInputDto {
  question: string;
  sourcePaths?: string[];
  maxSources?: number;
  perSourceBudget?: number;
}

interface MatrixRow {
  sourcePath: string;
  ok: boolean;
  stance: string;
  keyFindings: string[];
  evidenceIds: string[];
  error?: string;
}

export interface MapSourcesOutput {
  question: string;
  /** Evidence matrix rows — document × stance, each with `[evidenceId]` citations. */
  rows: MatrixRow[];
  diagnostics: {
    selection: "explicit" | "relevance";
    requested: number;
    completed: number;
    failed: number;
  };
}

const MAX_QUESTION_CHARS = 1_000;
const MAX_SOURCE_PATHS = 20;
const MAX_SOURCE_PATH_CHARS = 500;

/**
 * Fan-out over corpus documents: launches one scoped sub-agent per source
 * (locked to that document's index path), then returns an evidence matrix —
 * document × stance with `[evidenceId]` citations. Use for corpus-wide compare
 * questions ("where do these papers agree/disagree on X"), not single lookups.
 * One document failing degrades to a flagged row instead of failing the call.
 */
export const MapSourcesTool = defineTool<
  { mapper: MapSources; evidence: EvidenceRegistry },
  MapSourcesInputDto,
  MapSourcesOutput
>({
  name: MAP_SOURCES_TOOL,
  description:
    "Fan out one sub-agent per indexed document to answer a corpus-wide question, then " +
    "return an evidence matrix (document × stance with [evidenceId] citations). Omit " +
    "sourcePaths to auto-select the most relevant documents. Prefer this over many " +
    "run_subagent calls when comparing a question across several documents.",
  schema: {
    question: str(MAX_QUESTION_CHARS, {
      required: true,
      description: "The corpus-wide question each document is judged against.",
    }),
    sourcePaths: strArray(MAX_SOURCE_PATHS, MAX_SOURCE_PATH_CHARS, {
      description: "Specific document paths to fan out over; omit to auto-select by relevance.",
    }),
    maxSources: int(1, MAX_SOURCE_PATHS, 8, {
      description: "Cap on how many documents to fan out over (default 8).",
    }),
    perSourceBudget: int(2, 12, 6, {
      description: "Per-document sub-agent round budget (default 6).",
    }),
  },
  execute: async (deps, input, context) => {
    let result;
    try {
      result = await deps.mapper.run({
        question: input.question,
        sourcePaths: input.sourcePaths,
        maxSources: input.maxSources,
        perSourceRounds: input.perSourceBudget,
        signal: context.signal,
        onProgress: (event) => {
          if (event.type === "source-start") {
            context.emit({
              type: SUB_AGENT_PHASE,
              message: `Analyzing ${baseName(event.sourcePath)} (${event.index + 1}/${event.total})…`,
            });
          }
        },
      });
    } catch {
      return toolFailure("map-sources-failed", "Fan-out over sources failed.", true);
    }

    if (result.rows.length === 0) {
      return toolFailure(
        "map-sources-empty",
        "No documents matched — provide sourcePaths or broaden the question.",
      );
    }

    for (const row of result.rows) {
      mergeRowEvidence(deps.evidence, row, context.callId);
    }

    return {
      ok: true,
      value: {
        question: result.question,
        rows: result.rows.map((row) => ({
          sourcePath: row.sourcePath,
          ok: row.ok,
          stance: row.stance,
          keyFindings: row.keyFindings,
          evidenceIds: row.evidenceIds,
          ...(row.error ? { error: row.error } : {}),
        })),
        diagnostics: result.diagnostics,
      },
    };
  },
});

// Re-register each source's index chunks into the parent registry. evidenceIds
// are the retriever's own stable ids, so the row's citations resolve unchanged.
function mergeRowEvidence(evidence: EvidenceRegistry, row: MapSourceRow, callId: string): void {
  for (const chunk of row.snapshot.evidence) {
    if (chunk.source.kind === "web") {
      continue;
    }
    try {
      evidence.registerIndexChunk(chunk, { callId, query: row.sourcePath });
    } catch {}
  }
}

function baseName(path: string): string {
  return path.split("/").pop() ?? path;
}
