import type { MapSourcesWorkerInput, MapSourcesWorkerPort } from "@application/ports/mapSources";
import type { SubAgentDelegator } from "@application/ports/subAgent";
import {
  DEFAULT_SUB_AGENT_SEARCHES,
  type SubAgentResultState,
  type SubAgentRunReceipt,
  type SubAgentRunRef,
} from "@core/research";
import {
  DEFAULT_PER_SOURCE_ROUNDS,
  MapSourcesFailure,
  PER_SOURCE_RESULT_CHARS,
} from "./mapSourcesInput";

export interface MapSourcesWorkerLimits {
  maxRounds: number;
  maxResultChars: number;
}

export interface MapSourcesWorkerAdapterDeps {
  delegator(limits: MapSourcesWorkerLimits): SubAgentDelegator;
}

/**
 * Runs each document worker as its own child session through a delegator whose grant has
 * the map_sources origin and the worker's limits. The session is narrowed to index-only
 * search of the single document; the create and submission identities derive from the
 * worker request id, so a replayed registration reuses the session and run it started.
 */
export class MapSourcesWorkerAdapter implements MapSourcesWorkerPort {
  constructor(private readonly deps: MapSourcesWorkerAdapterDeps) {}

  async runSource(input: MapSourcesWorkerInput): Promise<SubAgentRunReceipt> {
    if (input.signal?.aborted) {
      throw new MapSourcesFailure("cancelled", "The fan-out was cancelled.");
    }
    const delegator = this.deps.delegator({
      maxRounds: input.maxRounds,
      maxResultChars: input.maxResultChars,
    });
    const session = await delegator.create({
      createRequestId: `create-${input.requestId}`,
      title: input.sourcePath.split("/").pop() || input.sourcePath,
      maxSearches: DEFAULT_SUB_AGENT_SEARCHES,
      scopeReduction: {
        searchMode: "indexOnly",
        contextPaths: [input.sourcePath],
        allowActiveFile: false,
      },
    });
    return delegator.run(
      session.subAgentSessionId,
      { type: "initial", task: input.task },
      `submit-${input.requestId}`,
    );
  }

  getResult(ref: SubAgentRunRef): Promise<SubAgentResultState> {
    return this.deps
      .delegator({ maxRounds: DEFAULT_PER_SOURCE_ROUNDS, maxResultChars: PER_SOURCE_RESULT_CHARS })
      .getResult(ref.sessionId, ref.runId);
  }
}
