import { branchProgressRows } from "@core/research/deepResearch";
import { researchBranch, researchPlan } from "../support/deepResearch";

describe("deep research branch progress rows", () => {
  it("numbers enabled branches by plan position and shows each branch's latest execution", () => {
    const plan = researchPlan([
      researchBranch(1),
      researchBranch(2, { enabled: false, priority: "optional" }),
      researchBranch(3, { dependsOn: ["branch-1"] }),
      researchBranch(4),
    ]);
    const execution = (branchId: string, state: "running" | "completed", partial = false) => ({
      workId: `${branchId}-${state}`,
      branchId,
      state,
      path: null,
      attempts: 1,
      finding: state === "completed" ? { text: "F", citationTokens: [], partial } : null,
      terminalReason: null,
    });
    const rows = branchProgressRows(plan, [
      execution("branch-1", "completed", true),
      execution("branch-4", "completed"),
      execution("branch-4", "running"),
    ]);
    expect(rows.map((row) => [row.number, row.status, row.after])).toEqual([
      [1, "partial", []],
      [3, "waiting", [1]],
      [4, "running", []],
    ]);
  });
});
