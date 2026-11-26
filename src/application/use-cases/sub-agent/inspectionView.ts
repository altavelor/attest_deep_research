import type {
  SubAgentInspectionDetail,
  SubAgentInspectionSnapshot,
  SubAgentSessionCard,
} from "@application/contracts/subAgentInspection";
import {
  deriveSubAgentTitle,
  mergeSubAgentUsage,
  safeSubAgentCode,
  type NormalizedUsage,
  type SubAgentInitialPrompt,
  type SubAgentObservationRecord,
  type SubAgentSessionSummary,
  type SubAgentRunSummary,
  type SubAgentSessionRecord,
  type SubAgentStateSnapshot,
  type SubAgentWorkflowItem,
} from "@core/research";

export interface SubAgentInspectionInputs {
  state: SubAgentStateSnapshot | null;
  revision: number;
  debug: boolean;
  redact(text: string): string;
  elapsed(runId: string): number;
  liveRevision(sessionId: string): number;
  parentLive(parentRunId: string): boolean;
}

type Row = Record<string, unknown>;

/** Returns the display title of a session from its first command, or its created title before any run. */
export function sessionDescription(
  record: SubAgentSessionRecord,
  redact: (text: string) => string,
): string {
  return deriveSubAgentTitle(redact(record.runs[0]?.command ?? record.session.title));
}

/** Returns the run a user stop must name: the active run, else the pending import, else the last run. */
export function controlRunIdOf(record: SubAgentSessionRecord): string | null {
  const { session } = record;
  return (
    session.activeSubAgentRunId ??
    session.pendingImportRunId ??
    record.runs[record.runs.length - 1]?.subAgentRunId ??
    null
  );
}

const WORKING_STATUSES: ReadonlySet<SubAgentSessionSummary["status"]> = new Set([
  "queued",
  "running",
  "importing",
  "stopping",
]);

/**
 * True when a working session has an active run or pending import whose owning parent run is
 * live. A failed session keeps its pending import for a late commit, but has nothing to stop.
 */
export function hasStoppableWork(
  session: SubAgentSessionSummary,
  isRevoked: (parentRunId: string) => boolean,
): boolean {
  return (
    WORKING_STATUSES.has(session.status) &&
    (session.activeSubAgentRunId !== null || session.pendingImportRunId !== null) &&
    !isRevoked(session.parentRunId)
  );
}

/** Builds the list snapshot of the chat's own sessions, running ones first and then newest first. */
export function buildInspectionSnapshot(
  inputs: SubAgentInspectionInputs,
): SubAgentInspectionSnapshot {
  const records = ownRecords(inputs.state);
  const sessions = records
    .map((record) => buildCard(record, inputs))
    .sort(
      (left, right) =>
        Number(right.status === "running") - Number(left.status === "running") ||
        right.updatedAt.localeCompare(left.updatedAt) ||
        (left.sessionId < right.sessionId ? -1 : left.sessionId > right.sessionId ? 1 : 0),
    );
  return {
    revision: inputs.revision,
    activeCount: sessions.filter((card) => card.status === "running").length,
    hasAgentRuns: records.some((record) => record.session.runCount > 0 || record.runs.length > 0),
    sessions,
  };
}

/** Builds the detail of one session of this chat, or null for an unknown or foreign session. */
export function buildInspectionDetail(
  inputs: SubAgentInspectionInputs,
  sessionId: string,
): SubAgentInspectionDetail | null {
  const record = ownRecords(inputs.state).find(
    (entry) => entry.session.subAgentSessionId === sessionId,
  );
  if (!record) return null;
  const observation = inputs.state?.observation ?? [];
  const lifetime = observation
    .filter((entry) => entry.sessionId === sessionId && entry.observationId.startsWith("tool:"))
    .map((entry, position) => workflowItem(entry, position + 1, inputs.debug));
  return copy({
    card: buildCard(record, inputs),
    runs: record.runs.map((run) => publicRun(run, inputs.redact)),
    selectedRunId: controlRunIdOf(record),
    initialPrompts: record.runs.map((run) => initialPrompt(run, observation)),
    lifetime,
  });
}

function publicRun(run: SubAgentRunSummary, redact: (text: string) => string): SubAgentRunSummary {
  return {
    ...run,
    command: redact(run.command),
    terminalReason: run.terminalReason === null ? null : safeSubAgentCode(run.terminalReason),
    resultSummary: run.resultSummary === null ? null : redact(run.resultSummary),
    ...(run.model ? { model: { ...run.model, label: redact(run.model.label) } } : {}),
  };
}

function ownRecords(state: SubAgentStateSnapshot | null): readonly SubAgentSessionRecord[] {
  if (!state) return [];
  return state.records.filter((record) => record.session.chatSessionId === state.chatId);
}

function buildCard(
  record: SubAgentSessionRecord,
  inputs: SubAgentInspectionInputs,
): SubAgentSessionCard {
  const { session } = record;
  const controlRunId = controlRunIdOf(record);
  const shown = record.runs.find((run) => run.subAgentRunId === controlRunId);
  const total = mergeSubAgentUsage(
    record.runs.flatMap((run) => runUsages(run, inputs.state?.observation ?? [])),
  );
  return copy({
    sessionId: session.subAgentSessionId,
    parentRunId: session.parentRunId,
    description: sessionDescription(record, inputs.redact),
    revision: session.revision + inputs.liveRevision(session.subAgentSessionId),
    status: session.status,
    model: shown?.model ?? null,
    usage: total.usage,
    usageIncomplete: total.incomplete,
    elapsedMs: record.runs.reduce((sum, run) => sum + runElapsed(run, inputs), 0),
    updatedAt: session.updatedAt,
    canStop: hasStoppableWork(session, (runId) => !inputs.parentLive(runId)),
    controlRunId,
  });
}

function runUsages(
  run: SubAgentRunSummary,
  observation: readonly SubAgentObservationRecord[],
): NormalizedUsage[] {
  const reported = observation
    .filter((entry) => entry.kind === "usage" && entry.runId === run.subAgentRunId)
    .map((entry) => (entry.payload as Row | null)?.usage as NormalizedUsage | undefined)
    .filter((usage): usage is NormalizedUsage => typeof usage === "object" && usage !== null);
  if (reported.length > 0 || run.usage.requestCount === 0) return reported;
  return [run.usage];
}

function runElapsed(run: SubAgentRunSummary, inputs: SubAgentInspectionInputs): number {
  if (run.status === "running" || run.status === "stopping") {
    return inputs.elapsed(run.subAgentRunId);
  }
  return run.usage.durationMs;
}

function initialPrompt(
  run: SubAgentRunSummary,
  observation: readonly SubAgentObservationRecord[],
): SubAgentInitialPrompt {
  const entry = observation.find((row) => row.observationId === `model:${run.subAgentRunId}`);
  const empty = { runId: run.subAgentRunId, capturedAt: null, messages: [], redacted: false };
  if (entry?.evicted) return { ...empty, state: "evicted", truncated: false };
  const prompt = (entry?.payload as Row | null | undefined)?.prompt as
    SubAgentInitialPrompt | undefined;
  if (prompt) return prompt;
  if (run.status === "queued" || run.status === "running") {
    return { ...empty, state: "not-started", truncated: false };
  }
  return { ...empty, state: "unavailable", truncated: false, unavailableReason: "not-recorded" };
}

function workflowItem(
  entry: SubAgentObservationRecord,
  position: number,
  debug: boolean,
): SubAgentWorkflowItem {
  const payload = entry.payload as SubAgentWorkflowItem | null;
  if (!payload || entry.evicted) {
    return {
      id: entry.observationId.slice(`tool:${entry.runId}:`.length),
      sessionId: entry.sessionId,
      runId: entry.runId,
      name: "",
      label: "",
      sequence: position,
      round: 0,
      status: "complete",
      startedAt: "",
      payloadState: "evicted",
    };
  }
  const { args: _args, resultJson: _resultJson, ...summary } = payload;
  const hasPayload = payload.args !== undefined || payload.resultJson !== undefined;
  if (payload.payloadState !== "captured" || !hasPayload) return summary;
  if (!debug) return { ...summary, payloadState: "disabled" };
  return payload;
}

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
