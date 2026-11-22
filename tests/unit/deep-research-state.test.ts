import {
  emptyBudgetState,
  presetLimits,
  validateResearchSection,
} from "@core/research/deepResearch";
import { pendingResearch, researchPlan } from "../support/deepResearch";

const pending = pendingResearch();
const approved = {
  ...pending,
  phase: "gathering",
  pending: null,
  plan: { ...pending.plan!, approvedAt: "2026-01-02T00:00:00.000Z" },
  executions: [
    {
      workId: "w-1",
      branchId: "branch-1",
      state: "completed",
      path: "main",
      attempts: 1,
      finding: { text: "Found", citationTokens: ["s1r1"], partial: false },
      terminalReason: null,
    },
    {
      workId: "w-2",
      branchId: "branch-2",
      state: "running",
      path: "main",
      attempts: 1,
      finding: null,
      terminalReason: null,
    },
  ],
  budget: {
    ...emptyBudgetState(),
    consumed: { branchAttempts: 2, modelRounds: 3, searches: 2, evidenceItems: 1 },
    attemptsByBranch: { "branch-1": 1, "branch-2": 1 },
    openAllocations: [
      { workId: "w-2", branchId: "branch-2", attempt: 1, modelRounds: 12, searches: 10 },
    ],
  },
};
const [done, running] = approved.executions;
const ended = {
  researchId: "research-0",
  question: "Q",
  phase: "cancelled",
  terminalReason: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  report: {
    reportId: "report-1",
    quality: "partial",
    completedBranches: ["branch-1"],
    missingBranches: [{ branchId: "branch-2", reason: "Time" }],
    stopReason: "Time",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
};

function tokens(count: number, length: number): string[] {
  return Array.from({ length: count }, (_, index) => `${index}`.padStart(length, "t"));
}

function budgetRows(): [string, unknown][] {
  const budget = approved.budget;
  const withBudget = (label: string, patch: Partial<typeof budget>): [string, unknown] => [
    label,
    section({ ...approved, budget: { ...budget, ...patch } }),
  ];
  return [
    withBudget("fractional active time", { activeMs: 1.5 }),
    withBudget("NaN active time", { activeMs: Number.NaN }),
    withBudget("attempt total off the branch counts", {
      consumed: { ...budget.consumed, branchAttempts: 3 },
    }),
    withBudget("branch count below its execution attempts", {
      attemptsByBranch: { "branch-1": 0, "branch-2": 2 },
    }),
    withBudget("branch count over its cap", {
      consumed: { ...budget.consumed, branchAttempts: 5 },
      attemptsByBranch: { "branch-1": 4, "branch-2": 1 },
    }),
    withBudget("rounds over the limit with the open allocation", {
      consumed: { ...budget.consumed, modelRounds: 270 },
    }),
    withBudget("searches over the limit with the open allocation", {
      consumed: { ...budget.consumed, searches: 95 },
    }),
    withBudget("open allocation on a closed budget", {
      closed: { reason: "time", dimension: null },
    }),
    withBudget("closure the owner never writes", {
      openAllocations: [],
      closed: { reason: "user", dimension: null },
    }),
  ];
}

function section(active: unknown, history: unknown[] = []) {
  return { schema: 1, active, history };
}

describe("deep research section validation", () => {
  it("rejects malformed and inconsistent sections as unreadable", () => {
    const rows: [string, unknown][] = [
      ["unknown schema", { ...section(pending), schema: 2 }],
      ["unsafe revision", section({ ...pending, revision: 2 ** 53 })],
      ["negative revision", section({ ...pending, revision: -1 })],
      ["fractional revision", section({ ...pending, revision: 1.5 })],
      ["unknown phase", section({ ...pending, phase: "dreaming", pending: null })],
      ["inner schema", section({ ...pending, schema: 2 })],
      ["terminal phase as active", section({ ...pending, phase: "completed", pending: null })],
      [
        "history over ten",
        section(
          null,
          Array.from({ length: 11 }, () => ended),
        ),
      ],
      [
        "limits off preset",
        section({
          ...pending,
          plan: { ...pending.plan!, limits: { ...presetLimits("thorough"), searchesTotal: 999 } },
        }),
      ],
      ["decision in planning", section({ ...pending, phase: "planning" })],
      ["plan decision without plan", section({ ...pending, plan: null })],
      [
        "artifact revision off plan",
        section({ ...pending, pending: { ...pending.pending!, artifactRevision: 7 } }),
      ],
      [
        "approved while awaiting",
        section({ ...pending, plan: { ...pending.plan!, approvedAt: "2026-01-02T00:00:00.000Z" } }),
      ],
      ["gathering without approval", section({ ...approved, plan: pending.plan })],
      [
        "unbounded timestamp",
        section({
          ...pending,
          createdAt: "Thursday, January 1, 2026 00:00:00 GMT+0000 (Coordinated Universal Time)",
        }),
      ],
      ["non-terminal phase in history", section(null, [{ ...ended, phase: "gathering" }])],
      ["bad timestamp in history", section(null, [{ ...ended, updatedAt: "yesterday" }])],
      ["over-long history reason", section(null, [{ ...ended, terminalReason: "r".repeat(4001) }])],
      [
        "too many objectives",
        section({
          ...pending,
          plan: researchPlan(undefined, "thorough", {
            objectives: Array.from({ length: 13 }, (_, i) => `O${i}`),
          }),
        }),
      ],
      [
        "execution of unknown branch",
        section({ ...approved, executions: [{ ...done, branchId: "x" }] }),
      ],
      [
        "completed without finding",
        section({ ...approved, executions: [{ ...done, finding: null }, running] }),
      ],
      [
        "duplicate work id",
        section({ ...approved, executions: [done, { ...running, workId: "w-1" }] }),
      ],
      ["executions before approval", section({ ...pending, executions: [running] })],
      [
        "finding over the bound",
        section({
          ...approved,
          executions: [
            { ...done, finding: { ...done!.finding!, text: "x".repeat(30_001) } },
            running,
          ],
        }),
      ],
      ["open allocation without running work", section({ ...approved, executions: [done] })],
      [
        "unknown closure reason",
        section({
          ...approved,
          budget: { ...approved.budget, closed: { reason: "bored", dimension: null } },
        }),
      ],
      [
        "negative consumption",
        section({
          ...approved,
          budget: { ...approved.budget, consumed: { ...approved.budget.consumed, searches: -1 } },
        }),
      ],
      ...budgetRows(),
      [
        "more tokens than the bound",
        section({
          ...approved,
          executions: [
            { ...done, finding: { ...done!.finding!, citationTokens: tokens(201, 8) } },
            running,
          ],
        }),
      ],
      [
        "over-long token",
        section({
          ...approved,
          executions: [
            { ...done, finding: { ...done!.finding!, citationTokens: tokens(1, 201) } },
            running,
          ],
        }),
      ],
      [
        "finding over the encoded size",
        section({
          ...approved,
          executions: [
            { ...done, finding: { ...done!.finding!, text: "\u0001".repeat(10_000) } },
            running,
          ],
        }),
      ],
      ["report in an active research", section({ ...approved, report: ended.report })],
      [
        "malformed history report",
        section(null, [{ ...ended, report: { ...ended.report, quality: "great" } }]),
      ],
    ];
    for (const [label, value] of rows) {
      expect(validateResearchSection(value).ok, label).toBe(false);
    }
  });

  it("accepts consistent sections and drops unknown keys", () => {
    const rebuilt = validateResearchSection(section(approved, [ended]));
    expect(rebuilt.ok && rebuilt.value).toEqual(section(approved, [ended]));
    const result = validateResearchSection({
      ...section({ ...pending, extra: 1, plan: { ...pending.plan!, extra: 2 } }, [
        { ...ended, extra: 3 },
      ]),
      extra: 4,
    });
    expect(result.ok && JSON.stringify(result.value)).not.toContain("extra");
  });
});
