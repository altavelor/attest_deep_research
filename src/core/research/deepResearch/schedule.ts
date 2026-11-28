import { label, type ResearchLabels } from "./reportLabels";
import type {
  BranchExecution,
  ResearchBranch,
  ResearchPlan,
  ResearchSourceScope,
  ResearchState,
  ResearchWork,
} from "./types";

const SETTLED_STATES: readonly BranchExecution["state"][] = [
  "completed",
  "failed",
  "skipped",
  "blocked",
];
const BLOCKING_STATES: readonly BranchExecution["state"][] = ["failed", "skipped", "blocked"];

/** Builds the pending gather executions of cycle one: one per enabled branch, in plan order. */
export function initialExecutions(plan: ResearchPlan): BranchExecution[] {
  return plan.branches
    .filter((branch) => branch.enabled)
    .map((branch) => ({
      workId: gatherWorkId(branch.branchId),
      branchId: branch.branchId,
      state: "pending",
      path: null,
      attempts: 0,
      finding: null,
      terminalReason: null,
    }));
}

/** Returns the work of every execution that has not settled yet, with the branch task. */
export function openWorks(state: ResearchState): ResearchWork[] {
  const branches = new Map(state.plan?.branches.map((branch) => [branch.branchId, branch]) ?? []);
  return state.executions
    .filter((execution) => !SETTLED_STATES.includes(execution.state))
    .flatMap((execution) => {
      const branch = branches.get(execution.branchId);
      return branch
        ? [
            {
              workId: execution.workId,
              branchId: execution.branchId,
              cycle: 1,
              kind: "gather" as const,
              task: branch.task,
            },
          ]
        : [];
    });
}

/** Returns executions with a running entry of a dead turn put back to pending. */
export function resumeExecutions(executions: readonly BranchExecution[]): BranchExecution[] {
  return executions.map((execution) =>
    execution.state === "running" ? { ...execution, state: "pending" } : execution,
  );
}

/**
 * Blocks every pending execution whose branch depends on a failed, skipped or blocked branch,
 * repeating until no more dependants change. A completed dependency never blocks.
 */
export function blockDependants(
  executions: readonly BranchExecution[],
  plan: ResearchPlan,
  labels: ResearchLabels,
): BranchExecution[] {
  let current = [...executions];
  for (;;) {
    const stateOf = branchStates(current);
    let changed = false;
    current = current.map((execution) => {
      if (execution.state !== "pending") return execution;
      const blocker = branchOf(plan, execution.branchId)?.dependsOn.find((id) =>
        BLOCKING_STATES.includes(stateOf.get(id) ?? "blocked"),
      );
      if (blocker === undefined) return execution;
      changed = true;
      const title = branchOf(plan, blocker)?.title ?? blocker;
      return {
        ...execution,
        state: "blocked",
        terminalReason: label(labels, "dependsOnFailed", { title }),
      };
    });
    if (!changed) return current;
  }
}

/**
 * Picks the next ready pending execution: every dependency completed, required branches before
 * optional ones and plan order within a priority.
 */
export function nextReadyExecution(
  executions: readonly BranchExecution[],
  plan: ResearchPlan,
): BranchExecution | null {
  const stateOf = branchStates(executions);
  const ready = plan.branches
    .map((branch) => ({
      branch,
      execution: executions.find(
        (entry) => entry.branchId === branch.branchId && entry.state === "pending",
      ),
    }))
    .filter(
      (entry): entry is { branch: ResearchBranch; execution: BranchExecution } =>
        entry.execution !== undefined &&
        entry.branch.dependsOn.every((id) => stateOf.get(id) === "completed"),
    );
  const required = ready.find((entry) => entry.branch.priority === "required");
  return (required ?? ready[0])?.execution ?? null;
}

function branchStates(
  executions: readonly BranchExecution[],
): Map<string, BranchExecution["state"]> {
  return new Map(executions.map((execution) => [execution.branchId, execution.state]));
}

function branchOf(plan: ResearchPlan, branchId: string): ResearchBranch | undefined {
  return plan.branches.find((branch) => branch.branchId === branchId);
}

function gatherWorkId(branchId: string): string {
  return `${branchId}-gather-1`;
}

/** Intersects a branch source scope with the chat's scope; null when they share no source. */
export function intersectScope(
  branch: ResearchSourceScope,
  chat: ResearchSourceScope,
): ResearchSourceScope | null {
  const index = branch !== "webOnly" && chat !== "webOnly";
  const web = branch !== "indexOnly" && chat !== "indexOnly";
  if (index && web) return "indexAndWeb";
  if (index) return "indexOnly";
  return web ? "webOnly" : null;
}

/**
 * Drops the run reference of every execution, discovery test and verification follow-up whose
 * session is no longer the one mapped to its branch, as after a refused session was replaced.
 */
export function withoutStaleRunRefs(
  state: ResearchState,
  sessionByBranch: Readonly<Record<string, string>>,
): ResearchState {
  const current = (execution: BranchExecution): BranchExecution => {
    if (!execution.runRef || sessionByBranch[execution.branchId] === execution.runRef.sessionId) {
      return execution;
    }
    const { runRef: _stale, ...rest } = execution;
    return rest;
  };
  return {
    ...state,
    executions: state.executions.map(current),
    discovery: state.discovery
      ? { ...state.discovery, executions: state.discovery.executions.map(current) }
      : null,
    verification: state.verification
      ? { ...state.verification, followUps: state.verification.followUps.map(current) }
      : null,
  };
}
