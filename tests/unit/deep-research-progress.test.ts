import {
  branchProgressRows,
  emptyBudgetState,
  reportFacts,
  sourcesFound,
} from "@core/research/deepResearch";
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
  it("calls a report complete only when its quality is complete and no branch is missing", () => {
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
        verification: null,
      },
    };
    const partial = { ...entry, report: { ...entry.report, quality: "partial" as const } };
    const missing = {
      ...entry,
      report: { ...entry.report, missingBranches: [{ branchId: "branch-2", reason: "Time" }] },
    };

    expect([
      reportFacts(entry).outcome,
      reportFacts(partial).outcome,
      reportFacts(missing).outcome,
      reportFacts(missing).branches,
      reportFacts({ ...entry, phase: "cancelled", report: null }).outcome,
      reportFacts({ ...entry, phase: "failed", report: null }).outcome,
    ]).toEqual(["complete", "partial", "partial", { done: 1, total: 2 }, "cancelled", "failed"]);
  });

  it("warns about missing sources, citations and summary only when the stored stats show them", () => {
    const base = {
      researchId: "r-1",
      question: "Q",
      phase: "completed" as const,
      terminalReason: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const report = {
      reportId: "report-1",
      quality: "complete" as const,
      completedBranches: ["branch-1"],
      missingBranches: [],
      stopReason: "Stop.",
      createdAt: "2026-01-01T00:00:00.000Z",
      verification: null,
    };
    const stats = {
      sourcesFound: 8,
      sourcesCited: 3,
      documentsOpened: 4,
      removedCitations: 0,
      uncitedBranches: [],
    };
    const facts = (overrides: object) =>
      reportFacts({ ...base, report: { ...report, ...overrides } });

    expect([
      facts({}).warnings,
      facts({}).sources,
      facts({}).time,
      facts({ stats }).warnings,
      facts({ stats }).sources,
      facts({ stats: { ...stats, documentsOpened: 0 } }).warnings,
      facts({ stats: { ...stats, documentsOpened: 0, sourcesFound: 0 } }).warnings,
      facts({ stats: { ...stats, removedCitations: 2 } }).warnings,
      facts({ scale: { objectives: 1, activeMs: 125_000, activeLimitMs: 0 } }).time,
      facts({ scale: { objectives: 1, activeMs: 125_000, activeLimitMs: 1_800_000 } }).time,
    ]).toEqual([
      [],
      null,
      null,
      [],
      { done: 3, total: 8 },
      [{ kind: "noDocuments" }],
      [],
      [{ kind: "removedCitations", count: 2 }],
      null,
      { minutes: 2, limitMinutes: 30 },
    ]);
  });

  it("counts found sources from the child runs, falls back to documents read, and never below the cited", () => {
    const withSources = (sources: number | undefined, evidenceItems: number) => {
      const budget = emptyBudgetState();
      return {
        ...budget,
        consumed: { ...budget.consumed, evidenceItems },
        diagnostics: { ...budget.diagnostics, ...(sources !== undefined ? { sources } : {}) },
      };
    };

    expect([
      sourcesFound(withSources(9, 2), 4),
      sourcesFound(withSources(undefined, 6), 4),
      sourcesFound(withSources(1, 0), 4),
    ]).toEqual([9, 6, 4]);
  });
});
