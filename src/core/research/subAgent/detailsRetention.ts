import type { SubAgentObservationRecord, SubAgentStateSnapshot } from "./stateSnapshot";
import { batchFindingBytes, evictBatchFindings } from "./batchState";

export interface SubAgentDetailsEviction {
  snapshot: SubAgentStateSnapshot;
  withinBudget: boolean;
}

const DETAIL_KINDS = new Set(["model-started", "tool-start", "tool-end", "phase"]);
const encoder = new TextEncoder();

/**
 * Keeps the serialized detail payloads of a section within a UTF-8 byte budget.
 * Details of the oldest terminal runs, ordered by completion time and then by
 * position, are evicted one run at a time and replaced by an evicted marker;
 * cited details, commands, summaries, usage, pending actions, markers and details
 * of non-terminal runs are never touched, so the result may stay over budget. Finding
 * texts of completed map_sources batches count too and are evicted after run details.
 */
export function evictSubAgentDetails(
  snapshot: SubAgentStateSnapshot,
  budgetBytes: number,
): SubAgentDetailsEviction {
  let total =
    snapshot.observation.reduce((sum, entry) => sum + detailBytes(entry), 0) +
    batchFindingBytes(snapshot.batches);
  if (total <= budgetBytes) return { snapshot, withinBudget: true };
  const evicted = new Set<string>();
  for (const runId of terminalRunsOldestFirst(snapshot)) {
    if (total <= budgetBytes) break;
    for (const entry of snapshot.observation) {
      if (entry.runId !== runId || entry.cited || detailBytes(entry) === 0) continue;
      total -= detailBytes(entry);
      evicted.add(entry.observationId);
    }
  }
  const batches = evictBatchFindings(snapshot.batches, total - budgetBytes);
  total -= batches.freed;
  if (evicted.size === 0 && batches.freed === 0) return { snapshot, withinBudget: false };
  const observation = snapshot.observation.map((entry) =>
    evicted.has(entry.observationId)
      ? { ...entry, payload: null, evicted: { reason: "chat size limit" as const } }
      : entry,
  );
  return {
    snapshot: {
      ...snapshot,
      observation,
      ...(batches.freed > 0 ? { batches: batches.batches } : {}),
    },
    withinBudget: total <= budgetBytes,
  };
}

function detailBytes(entry: SubAgentObservationRecord): number {
  if (!DETAIL_KINDS.has(entry.kind) || entry.evicted) return 0;
  return encoder.encode(JSON.stringify(entry.payload)).length;
}

function terminalRunsOldestFirst(snapshot: SubAgentStateSnapshot): string[] {
  const runs = snapshot.records.flatMap((record) =>
    record.runs.filter(
      (run) =>
        run.status === "completed" || run.status === "failed" || run.status === "interrupted",
    ),
  );
  return runs
    .map((run, position) => ({ run, position }))
    .sort(
      (left, right) =>
        (left.run.completedAt ?? "").localeCompare(right.run.completedAt ?? "") ||
        left.position - right.position,
    )
    .map(({ run }) => run.subAgentRunId);
}
