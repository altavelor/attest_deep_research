import {
  MAP_SOURCES_RESULT_TOOL,
  MAP_SOURCES_TOOL,
  toolFailure,
  type ToolExecution,
} from "@core/agent";
import {
  MAX_MAP_SOURCES_PATH_CHARS,
  MAX_MAP_SOURCES_QUESTION_CHARS,
  MAX_MAP_SOURCES_ROWS,
  SubAgentSessionFailure,
  type MapSourcesBatchReceipt,
  type MapSourcesBatchState,
} from "@core/research";
import { MapSources, MapSourcesFailure } from "@application/use-cases/map-sources";
import { defineTool, int, str, strArray } from "@application/sources/tools";
import { subAgentCallIdentity } from "../sub-agent/subAgentCalls";

export interface MapSourcesInputDto {
  question: string;
  sourcePaths?: string[];
  maxSources?: number;
  perSourceBudget?: number;
}

export interface MapSourcesAccepted {
  state: "accepted";
  receipt: MapSourcesBatchReceipt;
}

export interface MapSourcesToolDeps {
  mapper: MapSources;
  parentRunId: string;
}

const MAX_BATCH_ID_CHARS = 200;

/**
 * Starts a fan-out batch with one sub-agent per document and returns its accepted receipt
 * at once; the evidence matrix is read later with get_map_sources_result. The batch
 * identity derives from the parent run, model round and call, so a replay reuses it.
 */
export const MapSourcesTool = defineTool<
  MapSourcesToolDeps,
  MapSourcesInputDto,
  MapSourcesAccepted
>({
  name: MAP_SOURCES_TOOL,
  description:
    "Start one sub-agent per indexed document to answer a corpus-wide question. It returns " +
    "immediately with an accepted batch receipt while the documents are analysed in the " +
    "background; read the evidence matrix (document × stance with [evidenceId] citations) " +
    "with get_map_sources_result. Omit sourcePaths to auto-select the most relevant " +
    "documents. Prefer this over many run_subagent calls when comparing a question across " +
    "several documents.",
  schema: {
    question: str(MAX_MAP_SOURCES_QUESTION_CHARS, {
      required: true,
      description: "The corpus-wide question each document is judged against.",
    }),
    sourcePaths: strArray(MAX_MAP_SOURCES_ROWS, MAX_MAP_SOURCES_PATH_CHARS, {
      description: "Specific document paths to fan out over; omit to auto-select by relevance.",
    }),
    maxSources: int(1, MAX_MAP_SOURCES_ROWS, 8, {
      description: "Cap on how many documents to fan out over (default 8).",
    }),
    perSourceBudget: int(2, 12, 6, {
      description: "Per-document sub-agent round budget (default 6).",
    }),
  },
  execute: async (deps, input, context) => {
    const requestId = subAgentCallIdentity(deps.parentRunId, context.round, context.callId);
    try {
      const receipt = await deps.mapper.start(
        {
          question: input.question,
          sourcePaths: input.sourcePaths,
          maxSources: input.maxSources,
          perSourceRounds: input.perSourceBudget,
          signal: context.signal,
        },
        requestId,
      );
      return { ok: true, value: { state: "accepted", receipt } };
    } catch (error) {
      return mapSourcesFailure(error);
    }
  },
});

/**
 * Reads the state of a fan-out batch: pending with counters, the completed evidence matrix
 * in selection order, or a failure. It never waits for documents and is safe to repeat.
 */
export const MapSourcesResultTool = defineTool<
  MapSourcesToolDeps,
  { batchId: string },
  MapSourcesBatchState
>({
  name: MAP_SOURCES_RESULT_TOOL,
  description:
    "Read a map_sources batch by batchId from its receipt: pending with progress counters, " +
    "completed with the evidence matrix, or failed. Safe to call again; it never restarts work. " +
    "Report rows flagged with an error as unanalysed rather than as silence.",
  schema: {
    batchId: str(MAX_BATCH_ID_CHARS, { required: true, description: "batchId from the receipt." }),
  },
  execute: async (deps, input) => {
    try {
      const state = await deps.mapper.getResult(input.batchId);
      const telemetry = state.state === "completed" ? deps.mapper.telemetryOf(input.batchId) : [];
      return {
        ok: true,
        value: state,
        ...(telemetry.length > 0 ? { diagnostic: { mapSources: [...telemetry] } } : {}),
      };
    } catch (error) {
      return mapSourcesFailure(error);
    }
  },
});

function mapSourcesFailure(error: unknown): ToolExecution<never> {
  if (error instanceof MapSourcesFailure) {
    return toolFailure(error.code, error.message, error.retryable);
  }
  if (error instanceof SubAgentSessionFailure) return toolFailure(error.code, error.message);
  return toolFailure("map-sources-failed", "Fan-out over sources failed.", true);
}
