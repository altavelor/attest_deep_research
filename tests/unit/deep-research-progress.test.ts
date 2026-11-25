import { branchProgressRows, reportFacts } from "@core/research/deepResearch";
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

describe("deep research report facts", () => {
  it("calls a report complete only without missing branches, conflicts or uncovered objectives", () => {
    const entry = {
      researchId: "research-1",
      question: "Q",
      phase: "completed" as const,
      terminalReason: null,
      createdAt: "t",
      updatedAt: "t",
      report: {
        reportId: "report-1",
        quality: "complete" as const,
        completedBranches: ["branch-1"],
        missingBranches: [],
        stopReason: "Done",
        createdAt: "t",
        verification: {
          supported: 3,
          conflicted: 0,
          unsupported: 0,
          unresolved: 0,
          uncoveredObjectives: [],
        },
      },
    };
    const conflicted = {
      ...entry,
      report: { ...entry.report, verification: { ...entry.report.verification, conflicted: 1 } },
    };
    const missing = {
      ...entry,
      report: { ...entry.report, missingBranches: [{ branchId: "branch-2", reason: "Time" }] },
    };
    const facts = reportFacts(entry);
    expect([
      facts.outcome,
      facts.objectives,
      reportFacts(conflicted).outcome,
      reportFacts(missing).outcome,
      reportFacts({ ...entry, phase: "cancelled", report: null }).outcome,
      reportFacts({ ...entry, phase: "failed", report: null }).outcome,
    ]).toEqual(["complete", null, "partial", "partial", "cancelled", "failed"]);
  });
});
