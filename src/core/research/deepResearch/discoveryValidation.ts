import type {
  ResearchCycle,
  ResearchHypothesis,
  ResearchNote,
  ResearchObservation,
  ResearchTest,
} from "./discoveryTypes";
import type { BranchExecution, ResearchDiscovery, ResearchPlan } from "./types";
import { MAX_DISCOVERY_TEXT_CHARS, MAX_RESEARCH_NOTES } from "./limits";
import { isResearchId, isRevision } from "./planValidation";
import { readExecution } from "./executionValidation";
import { USER_OBSERVATION_LIMITATION, reduceHypothesis } from "./discovery";
import {
  MAX_DISCOVERY_BYTES,
  MAX_DISCOVERY_OMISSIONS,
  MAX_NOTE_TEXT_CHARS,
  MAX_NOTE_TOKENS,
  MAX_OBSERVATION_QUOTE_CHARS,
  MAX_OBSERVATION_TOKENS,
  MAX_RESEARCH_HYPOTHESES,
  MAX_RESEARCH_OBSERVATIONS,
  MAX_RESEARCH_TESTS,
  MAX_TEST_FINDING_CHARS,
  MAX_TEST_FINDING_TOKENS,
  discoveryBytes,
} from "./discoveryBounds";

const STATUSES: readonly ResearchHypothesis["status"][] = [
  "untested",
  "supported",
  "disconfirmed",
  "inconclusive",
];
const TEST_STATUSES: readonly ResearchTest["status"][] = [
  "proposed",
  "awaiting-input",
  "observed",
  "unavailable",
];
const VERDICTS: readonly ResearchObservation["verdict"][] = [
  "supports",
  "contradicts",
  "inconclusive",
];
const DECISIONS: readonly ResearchCycle["decision"][] = [
  "continue",
  "await-observation",
  "finish",
  "exhausted",
];
const MAX_TOKEN_CHARS = 200;
const MAX_TIMESTAMP = 40;

/**
 * Reads the stored discovery of an approved plan and rebuilds it from validated fields, or returns
 * undefined when a field is malformed or over its bound, a reference names an unknown branch,
 * hypothesis, test, observation or work, or a stored status differs from the one its own
 * observations give.
 */
export function readDiscovery(
  value: unknown,
  plan: ResearchPlan | null,
  otherWorks: readonly BranchExecution[],
): ResearchDiscovery | null | undefined {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || !plan?.approvedAt) return undefined;
  const hypotheses = list(value.hypotheses, MAX_RESEARCH_HYPOTHESES, readHypothesis);
  const tests = list(value.tests, MAX_RESEARCH_TESTS, readTest);
  const observations = list(value.observations, MAX_RESEARCH_OBSERVATIONS, readObservation);
  const cycles = list(value.cycles, plan.limits.researchCycles, readCycle);
  const notes = list(value.notes, MAX_RESEARCH_NOTES, readNote);
  const executions = list(value.executions, MAX_RESEARCH_TESTS, readTestExecution);
  if (
    !hypotheses ||
    !tests ||
    !observations ||
    !cycles ||
    !notes ||
    !executions ||
    !isTextList(value.omissions, MAX_DISCOVERY_OMISSIONS, MAX_DISCOVERY_TEXT_CHARS)
  ) {
    return undefined;
  }
  const discovery: ResearchDiscovery = {
    hypotheses,
    tests,
    observations,
    cycles,
    notes,
    executions,
    omissions: [...value.omissions],
  };
  return discoveryConsistent(discovery, plan, otherWorks) &&
    discoveryBytes(discovery) <= MAX_DISCOVERY_BYTES
    ? discovery
    : undefined;
}

function discoveryConsistent(
  discovery: ResearchDiscovery,
  plan: ResearchPlan,
  otherWorks: readonly BranchExecution[],
): boolean {
  const { hypotheses, tests, observations, cycles, notes, executions } = discovery;
  const branches = new Set(plan.branches.map((branch) => branch.branchId));
  const revisions = new Map(
    hypotheses.map((hypothesis) => [key(hypothesis.hypothesisId, hypothesis.revision), hypothesis]),
  );
  const testsById = new Map(tests.map((test) => [test.testId, test]));
  const observationsById = new Map(observations.map((entry) => [entry.observationId, entry]));
  const otherIds = new Set(otherWorks.map((execution) => execution.workId));
  const executionsById = new Map(executions.map((execution) => [execution.workId, execution]));
  if (
    revisions.size !== hypotheses.length ||
    testsById.size !== tests.length ||
    observationsById.size !== observations.length ||
    executionsById.size !== executions.length ||
    executions.some((execution) => otherIds.has(execution.workId))
  ) {
    return false;
  }
  const hypothesesValid = hypotheses.every((hypothesis) => {
    const previous = hypothesis.previousRevision;
    return (
      branches.has(hypothesis.branchId) &&
      (hypothesis.revision === 1
        ? previous === null
        : previous === hypothesis.revision - 1 &&
          revisions.has(key(hypothesis.hypothesisId, previous))) &&
      hypothesis.observationIds.every((id) => {
        const test = testsById.get(observationsById.get(id)?.testId ?? "");
        return (
          test?.hypothesisId === hypothesis.hypothesisId &&
          test.hypothesisRevision === hypothesis.revision
        );
      }) &&
      reduceHypothesis({ ...hypothesis, status: "untested" }, observations).status ===
        hypothesis.status
    );
  });
  const testsValid = tests.every((test) => {
    const hypothesis = revisions.get(key(test.hypothesisId, test.hypothesisRevision));
    const execution = executionsById.get(test.testId);
    const observed = observations.some((entry) => entry.testId === test.testId);
    return (
      hypothesis !== undefined &&
      (test.kind === "literature-check"
        ? execution?.branchId === hypothesis.branchId && test.status !== "awaiting-input"
        : execution === undefined && test.status !== "proposed") &&
      observed === (test.status === "observed")
    );
  });
  const observationsValid = observations.every((entry) => {
    const test = testsById.get(entry.testId);
    return (
      test !== undefined &&
      (entry.producer === "source") === (test.kind === "literature-check") &&
      (entry.producer === "user"
        ? entry.citationTokens.length === 0 &&
          entry.limitations.includes(USER_OBSERVATION_LIMITATION)
        : entry.verdict === "inconclusive" ||
          (entry.quote !== null && entry.citationTokens.length > 0)) &&
      hypotheses.some((hypothesis) => hypothesis.observationIds.includes(entry.observationId))
    );
  });
  const works = new Set([...otherIds, ...executionsById.keys()]);
  const cyclesValid = cycles.every(
    (cycle, index) =>
      cycle.ordinal === index + 1 && cycle.workIds.every((workId) => works.has(workId)),
  );
  const notesValid = notes.every(
    (note, index) =>
      (index === 0 || note.sequence > notes[index - 1]!.sequence) &&
      note.cycle <= cycles.length + 1,
  );
  return (
    hypothesesValid &&
    testsValid &&
    observationsValid &&
    cyclesValid &&
    notesValid &&
    executions.every((execution) => tests.some((test) => test.testId === execution.workId))
  );
}

function readHypothesis(value: unknown): ResearchHypothesis | undefined {
  if (
    !isRecord(value) ||
    !isResearchId(value.hypothesisId) ||
    !isRevision(value.revision) ||
    value.revision < 1 ||
    !(value.previousRevision === null || isRevision(value.previousRevision)) ||
    !isResearchId(value.branchId) ||
    !["claim", "alternative", "prediction", "disconfirmation"].every((field) =>
      isText(value[field], MAX_DISCOVERY_TEXT_CHARS),
    ) ||
    !STATUSES.includes(value.status as ResearchHypothesis["status"]) ||
    !isIdList(value.observationIds, MAX_RESEARCH_OBSERVATIONS)
  ) {
    return undefined;
  }
  return {
    hypothesisId: value.hypothesisId,
    revision: value.revision,
    previousRevision: value.previousRevision as number | null,
    branchId: value.branchId,
    claim: value.claim as string,
    alternative: value.alternative as string,
    prediction: value.prediction as string,
    disconfirmation: value.disconfirmation as string,
    status: value.status as ResearchHypothesis["status"],
    observationIds: [...value.observationIds],
  };
}

function readTest(value: unknown): ResearchTest | undefined {
  if (
    !isRecord(value) ||
    !isResearchId(value.testId) ||
    !isResearchId(value.hypothesisId) ||
    !isRevision(value.hypothesisRevision) ||
    (value.kind !== "literature-check" && value.kind !== "supplied-observation") ||
    !isText(value.method, MAX_DISCOVERY_TEXT_CHARS) ||
    !TEST_STATUSES.includes(value.status as ResearchTest["status"])
  ) {
    return undefined;
  }
  return {
    testId: value.testId,
    hypothesisId: value.hypothesisId,
    hypothesisRevision: value.hypothesisRevision,
    kind: value.kind,
    method: value.method,
    status: value.status as ResearchTest["status"],
  };
}

function readObservation(value: unknown): ResearchObservation | undefined {
  if (
    !isRecord(value) ||
    !isResearchId(value.observationId) ||
    !isResearchId(value.testId) ||
    (value.producer !== "source" && value.producer !== "user") ||
    !isTextList(value.citationTokens, MAX_OBSERVATION_TOKENS, MAX_TOKEN_CHARS) ||
    !VERDICTS.includes(value.verdict as ResearchObservation["verdict"]) ||
    !(value.quote === null || isText(value.quote, MAX_OBSERVATION_QUOTE_CHARS)) ||
    !isTextList(value.limitations, 2, MAX_DISCOVERY_TEXT_CHARS) ||
    !(value.observedAt === null || isTimestamp(value.observedAt)) ||
    !isTimestamp(value.receivedAt)
  ) {
    return undefined;
  }
  return {
    observationId: value.observationId,
    testId: value.testId,
    producer: value.producer,
    citationTokens: [...value.citationTokens],
    verdict: value.verdict as ResearchObservation["verdict"],
    quote: value.quote as string | null,
    limitations: [...value.limitations],
    observedAt: value.observedAt as string | null,
    receivedAt: value.receivedAt,
  };
}

function readCycle(value: unknown): ResearchCycle | undefined {
  if (
    !isRecord(value) ||
    !isRevision(value.ordinal) ||
    !isIdList(value.workIds, MAX_RESEARCH_TESTS * 2) ||
    !DECISIONS.includes(value.decision as ResearchCycle["decision"]) ||
    !isText(value.reason, MAX_DISCOVERY_TEXT_CHARS)
  ) {
    return undefined;
  }
  return {
    ordinal: value.ordinal,
    workIds: [...value.workIds],
    decision: value.decision as ResearchCycle["decision"],
    reason: value.reason,
  };
}

function readNote(value: unknown): ResearchNote | undefined {
  if (
    !isRecord(value) ||
    !isRevision(value.sequence) ||
    !isRevision(value.cycle) ||
    !["attempted", "outcome", "decision", "nextAction"].every((field) =>
      isText(value[field], MAX_NOTE_TEXT_CHARS),
    ) ||
    !isTextList(value.citationTokens, MAX_NOTE_TOKENS, MAX_TOKEN_CHARS)
  ) {
    return undefined;
  }
  return {
    sequence: value.sequence,
    cycle: value.cycle,
    attempted: value.attempted as string,
    outcome: value.outcome as string,
    citationTokens: [...value.citationTokens],
    decision: value.decision as string,
    nextAction: value.nextAction as string,
  };
}

function readTestExecution(value: unknown): BranchExecution | undefined {
  const execution = readExecution(value);
  if (!execution) return undefined;
  const finding = execution.finding;
  if (
    finding &&
    (finding.text.length > MAX_TEST_FINDING_CHARS ||
      finding.citationTokens.length > MAX_TEST_FINDING_TOKENS)
  ) {
    return undefined;
  }
  return execution;
}

function list<T>(value: unknown, max: number, read: (entry: unknown) => T | undefined): T[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const entries = value.map(read);
  return entries.includes(undefined) ? null : (entries as T[]);
}

function key(hypothesisId: string, revision: number): string {
  return `${hypothesisId}#${revision}`;
}

function isIdList(value: unknown, max: number): value is string[] {
  return Array.isArray(value) && value.length <= max && value.every(isResearchId);
}

function isTextList(value: unknown, maxItems: number, maxChars: number): value is string[] {
  return (
    Array.isArray(value) && value.length <= maxItems && value.every((v) => isText(v, maxChars))
  );
}

function isText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function isTimestamp(value: unknown): value is string {
  return isText(value, MAX_TIMESTAMP) && !Number.isNaN(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
