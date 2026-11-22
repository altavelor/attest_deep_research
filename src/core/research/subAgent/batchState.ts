import {
  MAP_SOURCES_EVICTED_FINDING,
  MAX_MAP_SOURCES_ERROR_CHARS,
  MAX_MAP_SOURCES_EVIDENCE_IDS,
  MAX_MAP_SOURCES_FINDING_CHARS,
  MAX_MAP_SOURCES_FINDINGS,
  MAX_MAP_SOURCES_PATH_CHARS,
  MAX_MAP_SOURCES_QUESTION_CHARS,
  MAX_MAP_SOURCES_ROWS,
  isTerminalBatchState,
  mapSourcesBatchError,
  type MapSourcesBatchRecord,
} from "../mapSourcesOutput";
import { isSubAgentStateId } from "./stateIds";

type Rec = Record<string, unknown>;

const BATCH_STATES = ["preparing", "pending", "completed", "failed", "interrupted"];
const SELECTIONS = ["explicit", "relevance"];
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u;
const SAFE_CODE = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const MAX_STANCE_CHARS = 32;
const encoder = new TextEncoder();

/**
 * Checks the optional map_sources batches of a section: safe unique ids, known states,
 * bounded texts and lists, refs to runs of this chat's own sessions, a result only on a
 * completed batch and bounded error strings. It returns the first invalid field path or null.
 */
export function checkMapSourcesBatches(
  value: unknown,
  runsBySession: ReadonlyMap<string, readonly string[]>,
): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return "batches";
  const seen = new Set<string>();
  for (const [index, entry] of value.entries()) {
    const path = `batches[${index}]`;
    const problem = checkBatch(entry, path, runsBySession);
    if (problem !== null) return problem;
    const batchId = (entry as Rec).batchId as string;
    if (seen.has(batchId)) return `${path}.batchId`;
    seen.add(batchId);
  }
  return null;
}

/**
 * Interrupts every preparing or pending batch at startup, because its parent run did
 * not survive the restart; completed and already terminal batches stay unchanged.
 */
export function recoverMapSourcesBatches(batches: readonly MapSourcesBatchRecord[] | undefined): {
  batches: readonly MapSourcesBatchRecord[] | undefined;
  changed: boolean;
} {
  if (!batches?.some((batch) => !isTerminalBatchState(batch.state))) {
    return { batches, changed: false };
  }
  return {
    changed: true,
    batches: batches.map((batch) =>
      isTerminalBatchState(batch.state)
        ? batch
        : {
            ...batch,
            state: "interrupted" as const,
            error: mapSourcesBatchError(
              "crash-recovery",
              "The batch was interrupted when the app restarted.",
            ),
          },
    ),
  };
}

/** Returns the serialized UTF-8 bytes of the finding texts of completed batches. */
export function batchFindingBytes(batches: readonly MapSourcesBatchRecord[] | undefined): number {
  return (batches ?? []).reduce((sum, batch) => sum + findingBytes(batch), 0);
}

/**
 * Replaces the finding texts of the oldest completed batches, by creation time and then
 * position, with one evicted marker until the excess is freed. Evidence IDs, stances and
 * errors stay, so cited evidence remains reachable; the freed byte count is returned.
 */
export function evictBatchFindings(
  batches: readonly MapSourcesBatchRecord[] | undefined,
  excessBytes: number,
): { batches: readonly MapSourcesBatchRecord[] | undefined; freed: number } {
  if (!batches || excessBytes <= 0) return { batches, freed: 0 };
  const order = batches
    .map((batch, position) => ({ batch, position }))
    .filter(({ batch }) => batch.state === "completed" && findingBytes(batch) > 0)
    .sort(
      (left, right) =>
        left.batch.createdAt.localeCompare(right.batch.createdAt) || left.position - right.position,
    );
  const evicted = new Set<number>();
  let freed = 0;
  for (const { batch, position } of order) {
    if (freed >= excessBytes) break;
    freed += findingBytes(batch) - findingBytes(withEvictedFindings(batch));
    evicted.add(position);
  }
  if (evicted.size === 0) return { batches, freed: 0 };
  return {
    batches: batches.map((batch, position) =>
      evicted.has(position) ? withEvictedFindings(batch) : batch,
    ),
    freed,
  };
}

function withEvictedFindings(batch: MapSourcesBatchRecord): MapSourcesBatchRecord {
  if (!batch.result) return batch;
  return {
    ...batch,
    result: {
      ...batch.result,
      rows: batch.result.rows.map((row) =>
        row.keyFindings.length > 0 ? { ...row, keyFindings: [MAP_SOURCES_EVICTED_FINDING] } : row,
      ),
    },
  };
}

function findingBytes(batch: MapSourcesBatchRecord): number {
  if (batch.state !== "completed" || !batch.result) return 0;
  return batch.result.rows.reduce(
    (sum, row) =>
      row.keyFindings.length === 1 && row.keyFindings[0] === MAP_SOURCES_EVICTED_FINDING
        ? sum
        : sum + encoder.encode(JSON.stringify(row.keyFindings)).length,
    0,
  );
}

function checkBatch(
  value: unknown,
  path: string,
  runsBySession: ReadonlyMap<string, readonly string[]>,
): string | null {
  if (!isRec(value)) return path;
  for (const key of ["batchId", "parentRunId", "requestId", "normalizedInputDigest"]) {
    if (!isSubAgentStateId(value[key])) return `${path}.${key}`;
  }
  if (!boundedText(value.question, MAX_MAP_SOURCES_QUESTION_CHARS)) return `${path}.question`;
  if (!isTime(value.createdAt)) return `${path}.createdAt`;
  if (!SELECTIONS.includes(value.selection as string)) return `${path}.selection`;
  const paths = value.sourcePaths;
  if (
    !Array.isArray(paths) ||
    paths.length > MAX_MAP_SOURCES_ROWS ||
    new Set(paths).size !== paths.length ||
    !paths.every((entry) => boundedText(entry, MAX_MAP_SOURCES_PATH_CHARS))
  ) {
    return `${path}.sourcePaths`;
  }
  const refsProblem = checkRefs(value.refs, paths as string[], `${path}.refs`, runsBySession);
  if (refsProblem !== null) return refsProblem;
  if (!BATCH_STATES.includes(value.state as string)) return `${path}.state`;
  if ((value.result !== undefined) !== (value.state === "completed")) return `${path}.result`;
  if (value.result !== undefined && !isOutput(value.result)) return `${path}.result`;
  if (value.error !== undefined && !isError(value.error)) return `${path}.error`;
  return null;
}

function checkRefs(
  value: unknown,
  paths: readonly string[],
  path: string,
  runsBySession: ReadonlyMap<string, readonly string[]>,
): string | null {
  if (!Array.isArray(value) || value.length > paths.length) return path;
  const covered = new Set<string>();
  for (const [index, entry] of value.entries()) {
    const at = `${path}[${index}]`;
    if (!isRec(entry) || !paths.includes(entry.sourcePath as string)) return at;
    if (covered.has(entry.sourcePath as string)) return at;
    covered.add(entry.sourcePath as string);
    const ref = entry.ref;
    if (!isRec(ref) || !isSubAgentStateId(ref.sessionId) || !isSubAgentStateId(ref.runId)) {
      return `${at}.ref`;
    }
    if (!runsBySession.get(ref.sessionId)?.includes(ref.runId)) return `${at}.ref`;
  }
  return null;
}

function isOutput(value: unknown): boolean {
  if (!isRec(value) || !boundedText(value.question, MAX_MAP_SOURCES_QUESTION_CHARS)) return false;
  const diagnostics = value.diagnostics;
  if (
    !isRec(diagnostics) ||
    !SELECTIONS.includes(diagnostics.selection as string) ||
    !["requested", "completed", "failed"].every((key) => isCount(diagnostics[key]))
  ) {
    return false;
  }
  return (
    Array.isArray(value.rows) &&
    value.rows.length <= MAX_MAP_SOURCES_ROWS &&
    value.rows.every(isRow)
  );
}

function isRow(value: unknown): boolean {
  return (
    isRec(value) &&
    boundedText(value.sourcePath, MAX_MAP_SOURCES_PATH_CHARS) &&
    typeof value.ok === "boolean" &&
    boundedText(value.stance, MAX_STANCE_CHARS) &&
    boundedList(
      value.keyFindings,
      MAX_MAP_SOURCES_FINDINGS,
      (entry) => typeof entry === "string" && entry.length <= MAX_MAP_SOURCES_FINDING_CHARS,
    ) &&
    boundedList(value.evidenceIds, MAX_MAP_SOURCES_EVIDENCE_IDS, isSubAgentStateId) &&
    (value.error === undefined || boundedText(value.error, MAX_MAP_SOURCES_ERROR_CHARS))
  );
}

function isError(value: unknown): boolean {
  return (
    isRec(value) &&
    typeof value.code === "string" &&
    SAFE_CODE.test(value.code) &&
    boundedText(value.message, MAX_MAP_SOURCES_ERROR_CHARS)
  );
}

function boundedList(value: unknown, max: number, check: (entry: unknown) => boolean): boolean {
  return Array.isArray(value) && value.length <= max && value.every(check);
}

function boundedText(value: unknown, max: number): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function isCount(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isTime(value: unknown): boolean {
  return typeof value === "string" && ISO_TIME.test(value) && !Number.isNaN(Date.parse(value));
}

function isRec(value: unknown): value is Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
