import {
  blockDependants,
  initialExecutions,
  isPlanStale,
  nextReadyExecution,
  reportDecision,
} from "@core/research/deepResearch";
import { researchBranch, researchPlan } from "../support/deepResearch";

const plan = researchPlan(
  [
    researchBranch(1),
    researchBranch(2, { dependsOn: ["branch-1"] }),
    researchBranch(3, { priority: "optional", objectives: [] }),
    researchBranch(4, { objectives: [] }),
  ],
  "thorough",
  { approvedAt: "2026-01-01T00:00:00.000Z" },
);
const settled = (states: Record<string, string>) =>
  initialExecutions(plan).map((execution) => ({
    ...execution,
    state: (states[execution.branchId] ?? execution.state) as typeof execution.state,
    finding:
      states[execution.branchId] === "completed"
        ? { text: "F", citationTokens: [], partial: false }
        : null,
  }));

describe("deep research scheduling rules", () => {
  it("blocks the dependants of a failed branch while a skipped optional one blocks nothing", () => {
    const executions = blockDependants(
      settled({ "branch-1": "failed", "branch-3": "skipped" }),
      plan,
    );
    expect(executions.map((execution) => execution.state)).toEqual([
      "failed",
      "blocked",
      "skipped",
      "pending",
    ]);
    expect(nextReadyExecution(executions, plan)?.branchId).toBe("branch-4");
  });

  it("reports partial when a required branch is missing and failed when none completed", () => {
    expect(
      reportDecision(plan, settled({ "branch-1": "completed", "branch-3": "completed" }), "Stop."),
    ).toMatchObject({
      kind: "report",
      quality: "partial",
      completedBranches: ["branch-1", "branch-3"],
    });
    expect(reportDecision(plan, settled({ "branch-1": "failed" }), "Stop.")).toEqual({
      kind: "failed",
      reason: "No branch completed. Stop.",
    });
  });

  it("treats a web plan approved exactly 24 hours ago as stale", () => {
    const web = researchPlan([researchBranch(1, { sourceScope: "webOnly" })], "thorough", {
      approvedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(isPlanStale(web, "2026-01-02T00:00:00.000Z")).toBe(true);
  });

  it("keeps an index plan fresh one millisecond before seven days", () => {
    expect(isPlanStale(plan, "2026-01-07T23:59:59.999Z")).toBe(false);
  });
});
