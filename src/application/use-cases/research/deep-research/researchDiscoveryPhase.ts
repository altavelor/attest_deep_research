import {
  MAX_NOTE_TEXT_CHARS,
  MAX_RESEARCH_HYPOTHESES,
  MAX_RESEARCH_TESTS,
  boundDiscovery,
  currentHypotheses,
  discoveryText,
  cycleDecisionReason,
  nextCycleDecision,
  reduceHypothesis,
  resumeExecutions,
  testWorkTask,
  type BranchExecution,
  type CycleDecision,
  type ResearchDiscovery,
  type ResearchObservation,
  type ResearchPlan,
  type ResearchStep,
  type ResearchWork,
} from "@core/research/deepResearch";
import type { ResearchDiscoveryService } from "./ResearchDiscoveryService";

export interface DiscoveryPhaseDeps {
  question: string;
  plan: ResearchPlan;
  gathered: readonly BranchExecution[];
  discovery: ResearchDiscovery | null;
  service: ResearchDiscoveryService;
  runTests(
    executions: readonly BranchExecution[],
    works: readonly ResearchWork[],
  ): Promise<readonly BranchExecution[]>;
  commit(discovery: ResearchDiscovery): Promise<void>;
  budgetClosed(): boolean;
  aborted(): boolean;
  onStep?(step: ResearchStep): void;
}

export interface DiscoveryPhaseResult {
  discovery: ResearchDiscovery;
  decision: CycleDecision | null;
}

const SETTLED = ["completed", "failed", "skipped", "blocked"];

/**
 * Runs the revision cycles that follow the gather wave: propose hypotheses, run their literature
 * checks as branch works through the scheduler, assess each finished check, reduce, note and
 * decide. It resumes an interrupted cycle without proposing again and returns the last decision,
 * or null when the turn was aborted.
 */
export async function runDiscoveryPhase(deps: DiscoveryPhaseDeps): Promise<DiscoveryPhaseResult> {
  let discovery = deps.discovery ?? (await started(deps));
  const commit = async (next: ResearchDiscovery): Promise<void> => {
    discovery = boundDiscovery(next);
    await deps.commit(discovery);
  };
  for (;;) {
    const last = discovery.cycles.at(-1)!;
    if (last.decision !== "continue" && last.decision !== "await-observation") {
      return { discovery, decision: last.decision };
    }
    if (deps.aborted()) return { discovery, decision: null };
    if (last.decision === "await-observation") {
      if (discovery.tests.some((test) => test.status === "awaiting-input")) {
        return { discovery, decision: "await-observation" };
      }
      const reason = discovery.observationsSkipped
        ? "Observations skipped."
        : "Observation received.";
      await commit(decided(deps, discovery, last.ordinal, true, reason));
      continue;
    }
    const ordinal = last.ordinal + 1;
    let revised = false;
    if (!discovery.tests.some((test) => test.status === "proposed")) {
      const current = currentHypotheses(discovery.hypotheses);
      const room = Math.min(
        MAX_RESEARCH_HYPOTHESES - discovery.hypotheses.length,
        MAX_RESEARCH_TESTS - discovery.tests.length,
      );
      if (room <= 0) {
        await commit(decided(deps, discovery, ordinal, false, "No room for more hypotheses."));
        continue;
      }
      deps.onStep?.({ kind: "proposing", cycle: ordinal });
      const proposed = await deps.service.propose(
        deps.question,
        deps.plan,
        [...deps.gathered, ...discovery.executions],
        current,
        room,
      );
      if (deps.aborted()) return { discovery, decision: null };
      if (proposed === null) {
        await commit(withCycle(discovery, ordinal, "exhausted", "No discovery round remains."));
        continue;
      }
      const planned = deps.service.plan(proposed.proposals, current);
      revised = planned.hypotheses.some((hypothesis) => hypothesis.revision > 1);
      discovery = {
        ...discovery,
        hypotheses: [...discovery.hypotheses, ...planned.hypotheses],
        tests: [...discovery.tests, ...planned.tests],
        executions: [...discovery.executions, ...planned.executions],
        omissions: [...discovery.omissions, ...proposed.omissions].slice(0, 8),
      };
      if (planned.hypotheses.length === 0) {
        const noted = withNote(discovery, ordinal, {
          attempted: "Proposed hypotheses",
          outcome: "No hypothesis helps this plan",
          decision: "finish",
          nextAction: "Verify the findings",
        });
        await commit(withCycle(noted, ordinal, "finish", "No hypothesis helps this plan."));
        continue;
      }
      await commit(discovery);
    }
    deps.onStep?.({ kind: "testing", cycle: ordinal });
    await runOpenTests(deps, () => discovery, commit);
    if (deps.aborted()) return { discovery, decision: null };
    const observed = await assessTests(deps, discovery, ordinal);
    discovery = observed.discovery;
    if (observed.refused) {
      await commit(withCycle(discovery, ordinal, "exhausted", "No discovery round remains."));
      continue;
    }
    await commit(decided(deps, discovery, ordinal, observed.progressed || revised, null));
  }
}

/** Adds a user observation to the test it answers and reduces the hypothesis revision it tests. */
export function withObservation(
  discovery: ResearchDiscovery,
  observation: ResearchObservation,
): ResearchDiscovery {
  const test = discovery.tests.find((entry) => entry.testId === observation.testId)!;
  const observations = [...discovery.observations, observation];
  return {
    ...discovery,
    observations,
    tests: discovery.tests.map((entry) =>
      entry.testId === test.testId ? { ...entry, status: "observed" } : entry,
    ),
    hypotheses: discovery.hypotheses.map((hypothesis) =>
      hypothesis.hypothesisId === test.hypothesisId &&
      hypothesis.revision === test.hypothesisRevision
        ? reduceHypothesis(
            {
              ...hypothesis,
              observationIds: [...hypothesis.observationIds, observation.observationId],
            },
            observations,
          )
        : hypothesis,
    ),
  };
}

/**
 * Ends the observation stage of a research: every supplied-observation test still open becomes
 * unavailable with a note that the user skipped it, and the flag keeps later cycles from asking.
 */
export function withObservationsSkipped(
  discovery: ResearchDiscovery,
  ordinal: number,
): ResearchDiscovery {
  let next: ResearchDiscovery = { ...discovery, observationsSkipped: true };
  for (const test of discovery.tests) {
    if (
      test.kind === "supplied-observation" &&
      (test.status === "proposed" || test.status === "awaiting-input")
    ) {
      next = unavailable(next, test.testId, ordinal, "Observation skipped by the user");
    }
  }
  return next;
}

async function started(deps: DiscoveryPhaseDeps): Promise<ResearchDiscovery> {
  const gathered = deps.gathered.map((execution) => execution.workId);
  const last = deps.plan.limits.researchCycles <= 1;
  const discovery: ResearchDiscovery = {
    hypotheses: [],
    tests: [],
    observations: [],
    cycles: [
      {
        ordinal: 1,
        workIds: gathered,
        decision: last ? "exhausted" : "continue",
        reason: last ? "The preset allows one research cycle." : "Gather wave settled.",
      },
    ],
    notes: [],
    executions: [],
    omissions: [],
  };
  await deps.commit(discovery);
  return discovery;
}

async function runOpenTests(
  deps: DiscoveryPhaseDeps,
  current: () => ResearchDiscovery,
  commit: (next: ResearchDiscovery) => Promise<void>,
): Promise<void> {
  const discovery = current();
  const executions = resumeExecutions(discovery.executions);
  const open = executions.filter((execution) => !SETTLED.includes(execution.state));
  if (open.length === 0 || deps.budgetClosed()) return;
  const works: ResearchWork[] = open.map((execution) => {
    const test = discovery.tests.find((entry) => entry.testId === execution.workId)!;
    const hypothesis = discovery.hypotheses.find(
      (entry) =>
        entry.hypothesisId === test.hypothesisId && entry.revision === test.hypothesisRevision,
    )!;
    return {
      workId: execution.workId,
      branchId: execution.branchId,
      cycle: discovery.cycles.length + 1,
      kind: "test",
      task: testWorkTask(hypothesis, test),
    };
  });
  const settled = await deps.runTests(executions, works);
  await commit({ ...current(), executions: [...settled] });
}

async function assessTests(
  deps: DiscoveryPhaseDeps,
  start: ResearchDiscovery,
  ordinal: number,
): Promise<{ discovery: ResearchDiscovery; progressed: boolean; refused: boolean }> {
  let discovery = start;
  let progressed = false;
  const judged = start.tests.filter((test) => test.status === "proposed");
  for (const test of start.tests) {
    if (test.status !== "proposed" || deps.aborted()) continue;
    const execution = discovery.executions.find((entry) => entry.workId === test.testId);
    if (!execution || !SETTLED.includes(execution.state)) {
      if (!deps.budgetClosed()) continue;
      discovery = unavailable(discovery, test.testId, ordinal, "Budget closed before the test ran");
      continue;
    }
    if (execution.state !== "completed") {
      discovery = unavailable(discovery, test.testId, ordinal, `Test ${execution.state}`);
      continue;
    }
    const hypothesis = discovery.hypotheses.find(
      (entry) =>
        entry.hypothesisId === test.hypothesisId && entry.revision === test.hypothesisRevision,
    )!;
    deps.onStep?.({
      kind: "judging",
      cycle: ordinal,
      done: judged.indexOf(test) + 1,
      total: judged.length,
    });
    const observation = await deps.service.assess(hypothesis, test, execution.finding);
    if (observation === null) {
      const left = discovery.tests.filter(
        (entry) => entry.status === "proposed" && entry.kind === "literature-check",
      );
      for (const entry of left) {
        discovery = unavailable(discovery, entry.testId, ordinal, "No discovery round remains");
      }
      return { discovery, progressed, refused: true };
    }
    discovery = withObservation(discovery, observation);
    progressed = true;
    const status = discovery.hypotheses.find(
      (entry) =>
        entry.hypothesisId === hypothesis.hypothesisId && entry.revision === hypothesis.revision,
    )!.status;
    discovery = withNote(discovery, ordinal, {
      attempted: test.method,
      outcome: `Observation ${observation.verdict}`,
      citationTokens: observation.citationTokens.slice(0, 1),
      decision: `Hypothesis ${status}`,
      nextAction: status === "supported" || status === "disconfirmed" ? "Settled" : "Revise",
    });
  }
  return { discovery, progressed, refused: false };
}

function unavailable(
  discovery: ResearchDiscovery,
  testId: string,
  ordinal: number,
  outcome: string,
): ResearchDiscovery {
  const test = discovery.tests.find((entry) => entry.testId === testId)!;
  return withNote(
    {
      ...discovery,
      tests: discovery.tests.map((entry) =>
        entry.testId === testId ? { ...entry, status: "unavailable" } : entry,
      ),
    },
    ordinal,
    { attempted: test.method, outcome, decision: "No observation", nextAction: "Continue" },
  );
}

function decided(
  deps: DiscoveryPhaseDeps,
  discovery: ResearchDiscovery,
  ordinal: number,
  progressed: boolean,
  reason: string | null,
): ResearchDiscovery {
  const skipped = discovery.observationsSkipped === true;
  if (skipped) discovery = withObservationsSkipped(discovery, ordinal);
  const input = {
    cycle: ordinal,
    researchCycles: deps.plan.limits.researchCycles,
    budgetClosed: deps.budgetClosed(),
    hypotheses: discovery.hypotheses,
    tests: discovery.tests,
    progressed,
    observationsSkipped: skipped,
  };
  const decision = nextCycleDecision(input);
  return withCycle(discovery, ordinal, decision, reason ?? cycleDecisionReason(decision, input));
}

function withCycle(
  discovery: ResearchDiscovery,
  ordinal: number,
  decision: CycleDecision,
  reason: string,
): ResearchDiscovery {
  const workIds = discovery.tests
    .filter((test) => discovery.executions.some((execution) => execution.workId === test.testId))
    .filter((test) => !discovery.cycles.some((cycle) => cycle.workIds.includes(test.testId)))
    .map((test) => test.testId);
  const kept = discovery.cycles.filter((cycle) => cycle.ordinal !== ordinal);
  const previous = discovery.cycles.find((cycle) => cycle.ordinal === ordinal);
  return {
    ...discovery,
    cycles: [
      ...kept,
      {
        ordinal,
        workIds: previous ? previous.workIds : workIds,
        decision,
        reason: discoveryText(reason),
      },
    ],
  };
}

function withNote(
  discovery: ResearchDiscovery,
  cycle: number,
  note: {
    attempted: string;
    outcome: string;
    decision: string;
    nextAction: string;
    citationTokens?: readonly string[];
  },
): ResearchDiscovery {
  const text = (value: string): string => discoveryText(value, MAX_NOTE_TEXT_CHARS) || "-";
  const sequence = (discovery.notes.at(-1)?.sequence ?? 0) + 1;
  return {
    ...discovery,
    notes: [
      ...discovery.notes,
      {
        sequence,
        cycle,
        attempted: text(note.attempted),
        outcome: text(note.outcome),
        citationTokens: [...(note.citationTokens ?? [])],
        decision: text(note.decision),
        nextAction: text(note.nextAction),
      },
    ],
  };
}
