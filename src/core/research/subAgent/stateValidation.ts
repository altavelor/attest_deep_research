import type { SubAgentStateSnapshot } from "./stateSnapshot";
import { isSubAgentModelSnapshot } from "./observationModel";
import { toValidatedJson } from "./stateSnapshot";
import { isSubAgentStateId } from "./stateIds";
import { checkMapSourcesBatches } from "./batchState";
import { readSubAgentSearchBudget, validateSubAgentResources } from "./validation";

export type SubAgentStateValidationCode = "unsupported-state-version" | "invalid-state-field";

export type SubAgentStateValidation =
  | { ok: true; snapshot: SubAgentStateSnapshot }
  | { ok: false; code: SubAgentStateValidationCode; message: string };

type Rec = Record<string, unknown>;

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u;
const SESSION_STATUSES = [
  "ready",
  "queued",
  "running",
  "importing",
  "stopping",
  "failed",
  "interrupted",
  "archived",
];
const RUN_STATUSES = ["queued", "running", "stopping", "completed", "failed", "interrupted"];
const IMPORT_STATES = ["prepared", "committed", "tombstoned"];
const ACTION_STATES = ["prepared", "reserved", "started", "settled", "unknown"];
const OBSERVATION_KINDS = ["model-started", "usage", "tool-start", "tool-end", "phase"];
const SEARCH_MODES = ["none", "indexOnly", "indexAndWeb", "webOnly"];

class InvalidField extends Error {}

export { isSubAgentStateId };

/**
 * Checks an untrusted sub-agent section against the step-1 domain model and the
 * section envelope: safe IDs, known statuses and discriminants, ISO timestamps,
 * non-negative finite counters and cross-references between sessions, runs and
 * submissions. It never repairs data; the first violation names its field path.
 */
export function validateSubAgentState(value: unknown): SubAgentStateValidation {
  if (!isRec(value) || value.version !== 1) {
    return {
      ok: false,
      code: "unsupported-state-version",
      message: "Sub-agent state has an unsupported version.",
    };
  }
  try {
    checkSnapshot(value);
    return { ok: true, snapshot: value as unknown as SubAgentStateSnapshot };
  } catch (error) {
    if (!(error instanceof InvalidField)) throw error;
    return {
      ok: false,
      code: "invalid-state-field",
      message: `Sub-agent state has an invalid field: ${error.message}.`,
    };
  }
}

function checkSnapshot(value: Rec): void {
  id(value.chatId, "chatId");
  count(value.revision, "revision");
  const sessionIds = new Set<string>();
  const runIds = new Set<string>();
  const runsBySession = new Map<string, readonly string[]>();
  list(value.records, "records").forEach((record, index) => {
    const path = `records[${index}]`;
    const sessionId = checkSession(rec(record.session, `${path}.session`), `${path}.session`);
    unique(sessionIds, sessionId, `${path}.session.subAgentSessionId`);
    const ownRuns = list(record.runs, `${path}.runs`).map((run, runIndex) => {
      const runPath = `${path}.runs[${runIndex}]`;
      const runId = checkRun(run, runPath);
      if (run.subAgentSessionId !== sessionId) invalid(`${runPath}.subAgentSessionId`);
      unique(runIds, runId, `${runPath}.subAgentRunId`);
      return runId;
    });
    runsBySession.set(sessionId, ownRuns);
    const session = record.session as Rec;
    if (session.chatSessionId !== value.chatId) invalid(`${path}.session.chatSessionId`);
    const newest = (record.runs as Rec[]).at(-1);
    if (newest && newest.parentRunId !== session.parentRunId) {
      invalid(`${path}.session.parentRunId`);
    }
    for (const key of ["activeSubAgentRunId", "pendingImportRunId"]) {
      if (session[key] !== null && !ownRuns.includes(session[key] as string)) {
        invalid(`${path}.session.${key}`);
      }
    }
  });
  list(value.creates, "creates").forEach((create, index) => {
    const path = `creates[${index}]`;
    ids(create, ["createRequestId", "normalizedInputDigest", "candidateSessionId"], path);
    oneOf(create.status, ["pending", "published", "denied"], `${path}.status`);
    nullable(create.publishedSessionId, `${path}.publishedSessionId`, id);
    nullable(create.terminalReason, `${path}.terminalReason`, text);
  });
  list(value.submissions, "submissions").forEach((submission, index) => {
    const path = `submissions[${index}]`;
    ids(submission, ["submissionId", "sessionId", "normalizedCommandDigest", "runId"], path);
    if (!sessionIds.has(submission.sessionId as string)) invalid(`${path}.sessionId`);
    const receipt = rec(submission.receipt, `${path}.receipt`);
    ids(receipt, ["sessionId", "runId", "submissionId"], `${path}.receipt`);
    time(receipt.acceptedAt, `${path}.receipt.acceptedAt`);
  });
  list(value.imports, "imports").forEach((entry, index) => {
    const path = `imports[${index}]`;
    checkImport(entry, path);
    if (entry.chatId !== value.chatId) invalid(`${path}.chatId`);
    checkRunReference(entry, path, runsBySession);
  });
  list(value.pendingActions, "pendingActions").forEach((entry, index) =>
    checkAction(entry, `pendingActions[${index}]`, runsBySession),
  );
  list(value.recoveryMarkers, "recoveryMarkers").forEach((entry, index) =>
    checkMarker(entry, `recoveryMarkers[${index}]`),
  );
  list(value.observation, "observation").forEach((entry, index) =>
    checkObservation(entry, `observation[${index}]`),
  );
  const batchProblem = checkMapSourcesBatches(value.batches, runsBySession);
  if (batchProblem !== null) invalid(batchProblem);
}

function checkSession(session: Rec, path: string): string {
  ids(session, ["subAgentSessionId", "createRequestId", "chatSessionId", "parentRunId"], path);
  ids(session, ["evidenceRegistryId"], path);
  oneOf(session.status, SESSION_STATUSES, `${path}.status`);
  text(session.title, `${path}.title`);
  for (const key of ["bindingGeneration", "lastImportGeneration", "runCount", "revision"]) {
    count(session[key], `${path}.${key}`);
  }
  nullable(session.activeSubAgentRunId, `${path}.activeSubAgentRunId`, id);
  nullable(session.pendingImportRunId, `${path}.pendingImportRunId`, id);
  nullable(session.pendingImportGeneration, `${path}.pendingImportGeneration`, count);
  nullable(session.contextSummary, `${path}.contextSummary`, text);
  time(session.createdAt, `${path}.createdAt`);
  time(session.updatedAt, `${path}.updatedAt`);
  checkSourcePolicy(session.sourcePolicy, `${path}.sourcePolicy`);
  checkRunOptions(session, path);
  const budget = rec(session.budgetPolicy, `${path}.budgetPolicy`);
  if (budget.type === "required-scope") id(budget.scopeId, `${path}.budgetPolicy.scopeId`);
  else if (budget.type !== "local") invalid(`${path}.budgetPolicy.type`);
  return session.subAgentSessionId as string;
}

function checkRunOptions(session: Rec, path: string): void {
  if (session.resources !== undefined) {
    const resources = validateSubAgentResources(session.resources);
    if (!resources.ok || JSON.stringify(resources.value) !== JSON.stringify(session.resources)) {
      invalid(`${path}.resources`);
    }
  }
  if (session.maxSearches === undefined) return;
  const searches = readSubAgentSearchBudget(session.maxSearches);
  if (!searches.ok || searches.value !== session.maxSearches) invalid(`${path}.maxSearches`);
}

function checkRun(run: Rec, path: string): string {
  ids(run, ["subAgentRunId", "subAgentSessionId", "parentRunId"], path);
  oneOf(run.status, RUN_STATUSES, `${path}.status`);
  oneOf(run.callerMode, ["instant", "thinking", "deep-research"], `${path}.callerMode`);
  oneOf(run.origin, ["direct", "map_sources"], `${path}.origin`);
  text(run.command, `${path}.command`);
  for (const key of ["attempt", "resultRevision", "evidenceCount"]) {
    count(run[key], `${path}.${key}`);
  }
  nullable(run.phase, `${path}.phase`, text);
  nullable(run.startedAt, `${path}.startedAt`, time);
  nullable(run.completedAt, `${path}.completedAt`, time);
  nullable(run.terminalReason, `${path}.terminalReason`, text);
  nullable(run.resultSummary, `${path}.resultSummary`, text);
  nullable(run.retryOfRunId, `${path}.retryOfRunId`, id);
  nullable(run.continuedFromRunId, `${path}.continuedFromRunId`, id);
  nullable(run.budgetScopeId, `${path}.budgetScopeId`, id);
  checkSourcePolicy(run.effectiveSourcePolicy, `${path}.effectiveSourcePolicy`);
  if (run.model !== undefined && !isSubAgentModelSnapshot(run.model)) invalid(`${path}.model`);
  const usage = rec(run.usage, `${path}.usage`);
  for (const key of ["requestCount", "modelRounds", "toolCalls", "durationMs"]) {
    count(usage[key], `${path}.usage.${key}`);
  }
  for (const key of [
    "inputTokens",
    "outputTokens",
    "totalTokens",
    "reasoningTokens",
    "cachedInputTokens",
    "cacheCreationInputTokens",
  ]) {
    if (usage[key] !== undefined) count(usage[key], `${path}.usage.${key}`);
  }
  oneOf(usage.source, ["provider", "estimated", "unavailable"], `${path}.usage.source`);
  return run.subAgentRunId as string;
}

function checkSourcePolicy(value: unknown, path: string): void {
  const policy = rec(value, path);
  oneOf(policy.searchMode, SEARCH_MODES, `${path}.searchMode`);
  oneOf(policy.indexScope, ["none", "all-allowed", "paths"], `${path}.indexScope`);
  list(policy.contextPaths as unknown, `${path}.contextPaths`, (entry, entryPath) =>
    text(entry, entryPath),
  );
  if (typeof policy.allowActiveFile !== "boolean") invalid(`${path}.allowActiveFile`);
  if (policy.allowNoteMutation !== false) invalid(`${path}.allowNoteMutation`);
}

function checkImport(entry: Rec, path: string): void {
  oneOf(entry.state, IMPORT_STATES, `${path}.state`);
  ids(entry, ["importId", "chatId", "sessionId", "runId", "evidenceDigest"], path);
  count(entry.generation, `${path}.generation`);
  json(entry.evidence, `${path}.evidence`);
  if (!Array.isArray(entry.evidence)) invalid(`${path}.evidence`);
  list(entry.aliases, `${path}.aliases`);
  json(entry.aliases, `${path}.aliases`);
  if (typeof entry.answerText !== "string") invalid(`${path}.answerText`);
  time(entry.createdAt, `${path}.createdAt`);
  if (entry.tombstoneReason !== undefined) text(entry.tombstoneReason, `${path}.tombstoneReason`);
  if (
    entry.evidenceBudgetExhausted !== undefined &&
    typeof entry.evidenceBudgetExhausted !== "boolean"
  )
    invalid(`${path}.evidenceBudgetExhausted`);
}

function checkRunReference(
  entry: Rec,
  path: string,
  runsBySession: ReadonlyMap<string, readonly string[]>,
): void {
  const runs = runsBySession.get(entry.sessionId as string);
  if (!runs) invalid(`${path}.sessionId`);
  if (!runs.includes(entry.runId as string)) invalid(`${path}.runId`);
}

function checkAction(
  entry: Rec,
  path: string,
  runsBySession: ReadonlyMap<string, readonly string[]>,
): void {
  oneOf(entry.state, ACTION_STATES, `${path}.state`);
  ids(entry, ["actionKey", "sessionId", "runId"], path);
  text(entry.action, `${path}.action`);
  for (const key of ["attempt", "ordinal", "fenceGeneration"]) count(entry[key], `${path}.${key}`);
  if (entry.permit !== undefined) json(entry.permit, `${path}.permit`);
  if (entry.outcome !== undefined) json(entry.outcome, `${path}.outcome`);
  checkRunReference(entry, path, runsBySession);
}

function checkMarker(entry: Rec, path: string): void {
  id(entry.parentRunId, `${path}.parentRunId`);
  text(entry.terminalReason, `${path}.terminalReason`);
  time(entry.createdAt, `${path}.createdAt`);
  list(entry.fencedRunIds as unknown, `${path}.fencedRunIds`, id);
  list(entry.unresolvedActionKeys as unknown, `${path}.unresolvedActionKeys`, id);
  list(entry.cancelledImports, `${path}.cancelledImports`).forEach((cancelled, index) => {
    id(cancelled.importId, `${path}.cancelledImports[${index}].importId`);
    count(cancelled.generation, `${path}.cancelledImports[${index}].generation`);
  });
}

function checkObservation(entry: Rec, path: string): void {
  oneOf(entry.kind, OBSERVATION_KINDS, `${path}.kind`);
  ids(entry, ["observationId", "sessionId", "runId"], path);
  if (typeof entry.cited !== "boolean") invalid(`${path}.cited`);
  json(entry.payload, `${path}.payload`);
  if (isRec(entry.payload) && entry.payload.prompt !== undefined) {
    checkPrompt(entry.payload.prompt, `${path}.payload.prompt`);
    if (rec(entry.payload.prompt, path).runId !== entry.runId) {
      invalid(`${path}.payload.prompt.runId`);
    }
  }
  if (entry.evicted !== undefined && rec(entry.evicted, path).reason !== "chat size limit") {
    invalid(`${path}.evicted`);
  }
}

function checkPrompt(value: unknown, path: string): void {
  const prompt = rec(value, path);
  id(prompt.runId, `${path}.runId`);
  nullable(prompt.capturedAt, `${path}.capturedAt`, time);
  oneOf(prompt.state, ["captured", "not-started", "unavailable", "evicted"], `${path}.state`);
  for (const key of ["redacted", "truncated"]) {
    if (typeof prompt[key] !== "boolean") invalid(`${path}.${key}`);
  }
  if (prompt.unavailableReason !== undefined)
    text(prompt.unavailableReason, `${path}.unavailableReason`);
  list(prompt.messages, `${path}.messages`).forEach((message, index) => {
    const messagePath = `${path}.messages[${index}]`;
    oneOf(message.role, ["system", "user", "assistant", "tool"], `${messagePath}.role`);
    if (typeof message.content !== "string") invalid(`${messagePath}.content`);
  });
}

function list(value: unknown, path: string): Rec[];
function list(value: unknown, path: string, check: (entry: unknown, path: string) => void): void;
function list(
  value: unknown,
  path: string,
  check?: (entry: unknown, path: string) => void,
): Rec[] | void {
  if (!Array.isArray(value)) invalid(path);
  const entries = value as unknown[];
  if (check) {
    entries.forEach((entry, index) => check(entry, `${path}[${index}]`));
    return;
  }
  return entries.map((entry, index) => rec(entry, `${path}[${index}]`));
}

function rec(value: unknown, path: string): Rec {
  if (!isRec(value)) invalid(path);
  return value as Rec;
}

function isRec(value: unknown): value is Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ids(value: Rec, keys: readonly string[], path: string): void {
  for (const key of keys) id(value[key], `${path}.${key}`);
}

function id(value: unknown, path: string): void {
  if (!isSubAgentStateId(value)) invalid(path);
}

function text(value: unknown, path: string): void {
  if (typeof value !== "string" || value.length === 0) invalid(path);
}

function time(value: unknown, path: string): void {
  if (typeof value !== "string" || !ISO_TIME.test(value) || Number.isNaN(Date.parse(value))) {
    invalid(path);
  }
}

function count(value: unknown, path: string): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) invalid(path);
}

function oneOf(value: unknown, allowed: readonly string[], path: string): void {
  if (typeof value !== "string" || !allowed.includes(value)) invalid(path);
}

function json(value: unknown, path: string): void {
  if (toValidatedJson(value) === undefined) invalid(path);
}

function nullable(value: unknown, path: string, check: (value: unknown, path: string) => void) {
  if (value !== null) check(value, path);
}

function unique(seen: Set<string>, value: string, path: string): void {
  if (seen.has(value)) invalid(path);
  seen.add(value);
}

function invalid(path: string): never {
  throw new InvalidField(path);
}
