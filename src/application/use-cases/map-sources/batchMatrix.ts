import type { SubAgentImportedEvidenceResolver } from "@application/ports/subAgent";
import type { SubAgentTelemetry } from "@application/research/subAgentPort";
import type { ResearchEvidenceSnapshot } from "@application/sources/evidence";
import {
  isSubAgentStateId,
  MAX_MAP_SOURCES_FINDING_CHARS,
  mapSourcesRowError,
  type MapSourcesBatchRecord,
  type MapSourcesOutput,
  type SubAgentResultState,
  type SubAgentRunRef,
} from "@core/research";
import { citedEvidenceIds, parseSourceAnswer } from "./mapSourcesParse";
import type { MapSourceRow, MapSourcesResult } from "./types";

export interface WorkerReading {
  sourcePath: string;
  ref: SubAgentRunRef | null;
  state: SubAgentResultState | null;
}

export interface BatchCounts {
  done: number;
  failed: number;
  running: number;
  settled: boolean;
}

const EMPTY_SNAPSHOT: ResearchEvidenceSnapshot = { evidence: [], citations: [], provenance: [] };

/** Counts finished, failed and running workers; settled when every worker has a terminal state. */
export function batchCounts(readings: readonly WorkerReading[]): BatchCounts {
  let done = 0;
  let failed = 0;
  let running = 0;
  let settled = true;
  for (const { ref, state } of readings) {
    if (!ref) {
      failed += 1;
    } else if (state?.state === "completed") {
      done += 1;
    } else if (state?.state === "failed" || state?.state === "interrupted") {
      failed += 1;
    } else {
      settled = false;
      if (state?.run.status === "running") running += 1;
    }
  }
  return { done, failed, running, settled };
}

/**
 * Builds the matrix of a settled batch in its stored selection order. A row succeeds only
 * from a completed imported outcome whose evidence resolves; every other row fails with a
 * "<code>: <redacted text>" error. Findings are redacted and IDs are kept only when safe.
 */
export async function buildBatchResult(
  record: MapSourcesBatchRecord,
  readings: readonly WorkerReading[],
  resolver: SubAgentImportedEvidenceResolver,
  redact: (text: string) => string,
  startErrors: ReadonlyMap<string, string> = new Map(),
): Promise<MapSourcesResult> {
  const rows: MapSourceRow[] = [];
  for (const sourcePath of record.sourcePaths) {
    const reading = readings.find((entry) => entry.sourcePath === sourcePath);
    rows.push(await rowOf(sourcePath, reading, resolver, redact, startErrors));
  }
  const completed = rows.filter((row) => row.ok).length;
  return {
    question: record.question,
    rows,
    diagnostics: {
      selection: record.selection,
      requested: rows.length,
      completed,
      failed: rows.length - completed,
    },
  };
}

/** Projects the internal result to the canonical wire matrix without snapshots or answers. */
export function toMapSourcesOutput(result: MapSourcesResult): MapSourcesOutput {
  const { selection, requested, completed, failed } = result.diagnostics;
  return {
    question: result.question,
    rows: result.rows.map((row) => ({
      sourcePath: row.sourcePath,
      ok: row.ok,
      stance: row.stance,
      keyFindings: row.keyFindings,
      evidenceIds: row.evidenceIds,
      ...(row.error ? { error: row.error } : {}),
    })),
    diagnostics: { selection, requested, completed, failed },
  };
}

/**
 * Builds the telemetry of one worker from its stored run, keyed by the real run id. A
 * worker that failed before any model request reports zero tokens and rounds.
 */
export function workerTelemetry(state: SubAgentResultState): SubAgentTelemetry {
  const run = state.state === "completed" ? state.outcome.run : state.run;
  const usage = run.usage;
  return {
    runId: run.subAgentRunId,
    durationMs: usage?.durationMs ?? 0,
    loopDurationMs: usage?.durationMs ?? 0,
    rounds: usage?.modelRounds ?? 0,
    maxRounds: 0,
    hitRoundLimit: run.terminalReason === "model-round-limit-exceeded",
    ...(state.state === "interrupted" ? { failureReason: "cancelled" as const } : {}),
    ...(state.state === "failed" ? { failureReason: "provider-error" as const } : {}),
    toolCalls: usage?.toolCalls ?? 0,
    duplicateToolCalls: 0,
    searchCalls: 0,
    maxSearches: 0,
    searchBudgetRejections: 0,
    usedSynthesisFallback: false,
    answerChars: state.state === "completed" ? state.outcome.answerText.length : 0,
    usage: {
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      reasoningTokens: usage?.reasoningTokens ?? 0,
    },
  };
}

async function rowOf(
  sourcePath: string,
  reading: WorkerReading | undefined,
  resolver: SubAgentImportedEvidenceResolver,
  redact: (text: string) => string,
  startErrors: ReadonlyMap<string, string>,
): Promise<MapSourceRow> {
  const state = reading?.state;
  if (!reading?.ref || !state) {
    const code = startErrors.get(sourcePath) ?? "not-started";
    return failedRow(sourcePath, code, "The document worker could not be started.", redact);
  }
  if (state.state === "pending") {
    return failedRow(sourcePath, "incomplete", "The document worker did not finish.", redact);
  }
  if (state.state !== "completed") {
    return failedRow(sourcePath, state.error.code, state.error.message, redact);
  }
  let snapshot: ResearchEvidenceSnapshot;
  try {
    snapshot = await resolver.resolve(state.outcome);
  } catch {
    return failedRow(
      sourcePath,
      "sources-unavailable",
      "The document's sources could not be resolved.",
      redact,
    );
  }
  const answer = state.outcome.answerText;
  const parsed = parseSourceAnswer(answer);
  return {
    sourcePath,
    ok: true,
    stance: parsed.stance,
    keyFindings: parsed.keyFindings
      .map((finding) => redact(finding).slice(0, MAX_MAP_SOURCES_FINDING_CHARS))
      .filter((finding) => finding.length > 0),
    evidenceIds: citedEvidenceIds(answer, snapshot).filter((id) => isSubAgentStateId(id)),
    answer,
    snapshot,
  };
}

function failedRow(
  sourcePath: string,
  code: string,
  message: string,
  redact: (text: string) => string,
): MapSourceRow {
  return {
    sourcePath,
    ok: false,
    stance: "unclear",
    keyFindings: [],
    evidenceIds: [],
    answer: "",
    error: mapSourcesRowError(code, redact(message)),
    snapshot: EMPTY_SNAPSHOT,
  };
}
