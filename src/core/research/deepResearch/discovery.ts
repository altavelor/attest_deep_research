import type {
  CycleDecision,
  ResearchHypothesis,
  ResearchNote,
  ResearchObservation,
  ResearchTest,
} from "./discoveryTypes";
import { MAX_RESEARCH_NOTES } from "./limits";

export const MAX_HYPOTHESIS_TEXT_CHARS = 300;
export const USER_OBSERVATION_LIMITATION = "reported, not independently checked";

export interface HypothesisDraft {
  branchId: string;
  claim: string;
  alternative: string;
  prediction: string;
  disconfirmation: string;
}

/**
 * Accepts a proposed hypothesis only when its claim, alternative explanation, prediction and
 * disconfirmation criterion are all present; each is bounded for storage. Returns null otherwise.
 */
export function acceptHypothesisDraft(
  draft: Partial<Record<keyof HypothesisDraft, unknown>>,
): HypothesisDraft | null {
  const fields = ["branchId", "claim", "alternative", "prediction", "disconfirmation"] as const;
  const values = fields.map((field) => {
    const value = draft[field];
    return typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
  });
  if (values.some((value) => value === "")) return null;
  const [branchId, claim, alternative, prediction, disconfirmation] = values.map((value) =>
    value.slice(0, MAX_HYPOTHESIS_TEXT_CHARS),
  ) as [string, string, string, string, string];
  return { branchId, claim, alternative, prediction, disconfirmation };
}

/**
 * Returns the status a hypothesis revision has from its own observations: any contradicting
 * observation disconfirms it, only supporting ones support it, no observation leaves it untested
 * and anything else is inconclusive. A disconfirmed revision is never changed.
 */
export function reduceHypothesis(
  hypothesis: ResearchHypothesis,
  observations: readonly ResearchObservation[],
): ResearchHypothesis {
  if (hypothesis.status === "disconfirmed") return hypothesis;
  const own = new Set(hypothesis.observationIds);
  const verdicts = observations
    .filter((observation) => own.has(observation.observationId))
    .map((observation) => observation.verdict);
  const status =
    verdicts.length === 0
      ? "untested"
      : verdicts.includes("contradicts")
        ? "disconfirmed"
        : verdicts.every((verdict) => verdict === "supports")
          ? "supported"
          : "inconclusive";
  return { ...hypothesis, status };
}

/** Returns the latest revision of every hypothesis, in the order the hypotheses were first proposed. */
export function currentHypotheses(hypotheses: readonly ResearchHypothesis[]): ResearchHypothesis[] {
  const latest = new Map<string, ResearchHypothesis>();
  for (const hypothesis of hypotheses) {
    const known = latest.get(hypothesis.hypothesisId);
    if (!known || known.revision < hypothesis.revision) {
      latest.set(hypothesis.hypothesisId, hypothesis);
    }
  }
  return [...latest.values()];
}

export interface CycleDecisionInput {
  cycle: number;
  researchCycles: number;
  budgetClosed: boolean;
  hypotheses: readonly ResearchHypothesis[];
  tests: readonly ResearchTest[];
  progressed: boolean;
}

/**
 * Decides what follows a finished cycle: finish when every current hypothesis is settled, wait
 * when only tests needing the user remain, stop as exhausted at the cycle cap or a closed budget,
 * continue only after progress and otherwise finish instead of looping.
 */
export function nextCycleDecision(input: CycleDecisionInput): CycleDecision {
  const current = currentHypotheses(input.hypotheses);
  const open = current.filter(
    (hypothesis) => hypothesis.status !== "supported" && hypothesis.status !== "disconfirmed",
  );
  if (open.length === 0) return "finish";
  const openIds = new Set(
    open.map((hypothesis) => `${hypothesis.hypothesisId}#${hypothesis.revision}`),
  );
  const remaining = input.tests.filter(
    (test) =>
      openIds.has(`${test.hypothesisId}#${test.hypothesisRevision}`) &&
      (test.status === "proposed" || test.status === "awaiting-input"),
  );
  if (remaining.length > 0 && remaining.every((test) => test.status === "awaiting-input")) {
    return "await-observation";
  }
  if (input.cycle >= input.researchCycles || input.budgetClosed) return "exhausted";
  return input.progressed ? "continue" : "finish";
}

/**
 * Builds the observation a user reports. It is text only: no citation tokens and always the
 * limitation that it was reported and not independently checked.
 */
export function userObservation(input: {
  observationId: string;
  testId: string;
  verdict: ResearchObservation["verdict"];
  quote: string;
  receivedAt: string;
}): ResearchObservation {
  return {
    observationId: input.observationId,
    testId: input.testId,
    producer: "user",
    citationTokens: [],
    verdict: input.verdict,
    quote: input.quote,
    limitations: [USER_OBSERVATION_LIMITATION],
    observedAt: null,
    receivedAt: input.receivedAt,
  };
}

/**
 * Keeps at most `MAX_RESEARCH_NOTES` notes, dropping the oldest first except notes that share a
 * citation token with an observation of a current hypothesis.
 */
export function boundNotes(
  notes: readonly ResearchNote[],
  referencedTokens: ReadonlySet<string>,
  max: number = MAX_RESEARCH_NOTES,
): ResearchNote[] {
  const kept = [...notes];
  for (let index = 0; kept.length > max && index < kept.length;) {
    if (kept[index]!.citationTokens.some((token) => referencedTokens.has(token))) index += 1;
    else kept.splice(index, 1);
  }
  return kept.length > max ? kept.slice(kept.length - max) : kept;
}
