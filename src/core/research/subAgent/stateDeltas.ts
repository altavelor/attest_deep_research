import type { SubAgentSessionRecord } from "./sessionModel";
import type {
  SubAgentBufferedValue,
  SubAgentStateEntity,
  SubAgentStateSnapshot,
} from "./stateSnapshot";
import { toValidatedJson } from "./stateSnapshot";

type Row = Record<string, unknown>;
type ListKey =
  "creates" | "submissions" | "imports" | "pendingActions" | "observation" | "recoveryMarkers";

const SESSION_FIELDS = [
  "subAgentSessionId",
  "createRequestId",
  "chatSessionId",
  "parentRunId",
  "bindingGeneration",
  "status",
  "title",
  "sourcePolicy",
  "budgetPolicy",
  "activeSubAgentRunId",
  "pendingImportRunId",
  "pendingImportGeneration",
  "lastImportGeneration",
  "runCount",
  "revision",
  "contextSummary",
  "evidenceRegistryId",
  "createdAt",
  "updatedAt",
];
const RUN_FIELDS = [
  "subAgentRunId",
  "subAgentSessionId",
  "parentRunId",
  "callerMode",
  "command",
  "origin",
  "attempt",
  "resultRevision",
  "status",
  "phase",
  "startedAt",
  "completedAt",
  "evidenceCount",
  "usage",
  "terminalReason",
  "resultSummary",
  "effectiveSourcePolicy",
  "retryOfRunId",
  "continuedFromRunId",
  "budgetScopeId",
];
const LISTS: Readonly<Record<string, { list: ListKey; idField: string; fields: string[] }>> = {
  create: {
    list: "creates",
    idField: "createRequestId",
    fields: [
      "createRequestId",
      "normalizedInputDigest",
      "candidateSessionId",
      "status",
      "publishedSessionId",
      "terminalReason",
    ],
  },
  submission: {
    list: "submissions",
    idField: "submissionId",
    fields: ["submissionId", "sessionId", "normalizedCommandDigest", "runId", "receipt"],
  },
  import: {
    list: "imports",
    idField: "importId",
    fields: [
      "state",
      "importId",
      "chatId",
      "sessionId",
      "runId",
      "evidenceDigest",
      "generation",
      "evidence",
      "aliases",
      "answerText",
      "createdAt",
      "tombstoneReason",
      "evidenceBudgetExhausted",
    ],
  },
  action: {
    list: "pendingActions",
    idField: "actionKey",
    fields: [
      "state",
      "actionKey",
      "sessionId",
      "runId",
      "attempt",
      "action",
      "ordinal",
      "fenceGeneration",
      "permit",
      "outcome",
    ],
  },
  observation: {
    list: "observation",
    idField: "observationId",
    fields: ["kind", "observationId", "sessionId", "runId", "cited", "payload", "evicted"],
  },
  marker: {
    list: "recoveryMarkers",
    idField: "parentRunId",
    fields: [
      "parentRunId",
      "terminalReason",
      "createdAt",
      "fencedRunIds",
      "cancelledImports",
      "unresolvedActionKeys",
    ],
  },
};

/**
 * Checks that a buffered delta names a supported entity, only allow-listed fields of
 * that entity and valid JSON values. It returns the reason for rejection or null;
 * the batch entity has no section storage until map_sources batches are added.
 */
export function checkSubAgentDelta(delta: SubAgentBufferedValue): string | null {
  const allowed = fieldsOf(delta.entity);
  if (!allowed) return `Unsupported sub-agent entity: ${delta.entity}`;
  if (delta.id.length === 0) return "Sub-agent delta needs an id";
  if (delta.op === "delete") return null;
  for (const [key, value] of Object.entries(delta.fields)) {
    if (!allowed.includes(key)) return `Field ${key} is not allowed for ${delta.entity}`;
    if (toValidatedJson(value) === undefined) return `Field ${key} is not valid JSON`;
  }
  return null;
}

/**
 * Applies one checked delta to an immutable section and returns the new section, or
 * null when the delta refers to a missing parent entity. A set merges the given
 * fields into the entity or creates it; a delete removes it.
 */
export function applySubAgentDelta(
  snapshot: SubAgentStateSnapshot,
  delta: SubAgentBufferedValue,
): SubAgentStateSnapshot | null {
  if (delta.entity === "session") return applySession(snapshot, delta);
  if (delta.entity === "run") return applyRun(snapshot, delta);
  const target = LISTS[delta.entity];
  if (!target) return null;
  const rows = snapshot[target.list] as unknown as readonly Row[];
  const rest = rows.filter((row) => row[target.idField] !== delta.id);
  if (delta.op === "delete") return { ...snapshot, [target.list]: rest };
  const existing = rows.find((row) => row[target.idField] === delta.id) ?? {};
  const next = { ...existing, ...delta.fields, [target.idField]: delta.id };
  const index = rows.findIndex((row) => row[target.idField] === delta.id);
  const updated = index < 0 ? [...rows, next] : rows.map((row, at) => (at === index ? next : row));
  return { ...snapshot, [target.list]: updated };
}

function applySession(
  snapshot: SubAgentStateSnapshot,
  delta: SubAgentBufferedValue,
): SubAgentStateSnapshot {
  const index = snapshot.records.findIndex(
    (record) => record.session.subAgentSessionId === delta.id,
  );
  if (delta.op === "delete") {
    return { ...snapshot, records: snapshot.records.filter((_, at) => at !== index) };
  }
  const existing = index < 0 ? undefined : snapshot.records[index];
  const session = { ...(existing?.session ?? {}), ...delta.fields, subAgentSessionId: delta.id };
  const record = { session, runs: existing?.runs ?? [] } as unknown as SubAgentSessionRecord;
  const records =
    index < 0
      ? [...snapshot.records, record]
      : snapshot.records.map((entry, at) => (at === index ? record : entry));
  return { ...snapshot, records };
}

function applyRun(
  snapshot: SubAgentStateSnapshot,
  delta: SubAgentBufferedValue,
): SubAgentStateSnapshot | null {
  const owner =
    snapshot.records.find((record) => record.runs.some((run) => run.subAgentRunId === delta.id)) ??
    snapshot.records.find(
      (record) =>
        delta.op === "set" && record.session.subAgentSessionId === delta.fields.subAgentSessionId,
    );
  if (!owner) return delta.op === "delete" ? snapshot : null;
  const runs = owner.runs.filter((run) => run.subAgentRunId !== delta.id);
  let nextRuns: SubAgentSessionRecord["runs"] = runs;
  if (delta.op === "set") {
    const existing = owner.runs.find((run) => run.subAgentRunId === delta.id);
    const run = { ...(existing ?? {}), ...delta.fields, subAgentRunId: delta.id };
    const index = owner.runs.findIndex((entry) => entry.subAgentRunId === delta.id);
    nextRuns = (
      index < 0 ? [...owner.runs, run] : owner.runs.map((entry, at) => (at === index ? run : entry))
    ) as SubAgentSessionRecord["runs"];
  }
  const record = { ...owner, runs: nextRuns };
  return {
    ...snapshot,
    records: snapshot.records.map((entry) => (entry === owner ? record : entry)),
  };
}

function fieldsOf(entity: SubAgentStateEntity): readonly string[] | undefined {
  if (entity === "session") return SESSION_FIELDS;
  if (entity === "run") return RUN_FIELDS;
  return LISTS[entity]?.fields;
}
