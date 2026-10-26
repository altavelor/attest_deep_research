import type {
  SubAgentExecutionEvent,
  SubAgentExecutionRequest,
  SubAgentPriorContext,
} from "@application/ports/subAgent";
import type { SubAgentRunSummary, SubAgentSessionRecord } from "@core/research";
import type { SubAgentManagerParts } from "./managerParts";
import { committedOutcome } from "./resultState";

const MAX_CONTEXT_CHARS = 4_000;
const MAX_PRIOR_EVIDENCE = 20;
const EMPTY_CONTEXT: SubAgentPriorContext = {
  summary: null,
  previousResult: null,
  partialSummary: null,
  priorEvidence: [],
};

/**
 * Builds the bounded execution request of a started run from host-owned limits only.
 * The task never selects limits; prior context is compacted before the runner starts.
 */
export function buildExecutionRequest(
  parts: SubAgentManagerParts,
  record: SubAgentSessionRecord,
  run: SubAgentRunSummary,
  signal: AbortSignal,
  observe: (event: SubAgentExecutionEvent) => void,
): SubAgentExecutionRequest {
  const options = parts.sessionOptions.get(record.session.subAgentSessionId);
  const grant = options?.grant;
  const activeFilePath = run.effectiveSourcePolicy.allowActiveFile
    ? grant?.capturedActiveFilePath
    : undefined;
  return {
    sessionId: record.session.subAgentSessionId,
    runId: run.subAgentRunId,
    attempt: run.attempt,
    task: run.command,
    sourcePolicy: run.effectiveSourcePolicy,
    ...(activeFilePath ? { activeFilePath } : {}),
    resources: options?.resources ?? [],
    limits: {
      maxRounds: grant?.limits.maxRounds ?? 0,
      maxResultChars: grant?.limits.maxResultChars ?? 0,
      maxSearches: options?.maxSearches ?? 0,
    },
    priorContext: priorContextOf(parts, record, run),
    signal,
    observe,
  };
}

/**
 * Selects the prior context of a run by its lineage. A first run has none; a follow-up
 * gets the session summary, the previous committed answer and its evidence; a retry
 * drops the earlier answer, and a partial continuation adds the explicit partial summary.
 */
function priorContextOf(
  parts: SubAgentManagerParts,
  record: SubAgentSessionRecord,
  run: SubAgentRunSummary,
): SubAgentPriorContext {
  const earlier = record.runs.slice(0, record.runs.indexOf(run));
  if (earlier.length === 0) return EMPTY_CONTEXT;
  const previous = [...earlier]
    .reverse()
    .map((candidate) => committedOutcome(parts, record, candidate))
    .find((outcome) => outcome !== undefined);
  const base: SubAgentPriorContext = {
    summary: bounded(record.session.contextSummary),
    previousResult: run.retryOfRunId ? null : bounded(previous?.answerText ?? null),
    partialSummary: null,
    priorEvidence: (previous?.evidence ?? []).slice(-MAX_PRIOR_EVIDENCE),
  };
  if (!run.continuedFromRunId) return base;
  const partial = earlier.find((candidate) => candidate.subAgentRunId === run.continuedFromRunId);
  return { ...base, partialSummary: bounded(partial?.resultSummary ?? null) };
}

function bounded(text: string | null): string | null {
  return text === null ? null : text.slice(0, MAX_CONTEXT_CHARS);
}
