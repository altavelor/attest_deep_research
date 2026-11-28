import {
  ResearchBudgetOwner,
  budgetLimits,
  emptyBudgetState,
  presetLimits,
  type ResearchLimits,
} from "@core/research/deepResearch";
import { researchBranch, researchPlan } from "../support/deepResearch";

const limits: ResearchLimits = {
  ...presetLimits("balanced"),
  attemptsPerBranch: 2,
  modelRoundsPerAttempt: 12,
  modelRoundsTotal: 40,
  finalizationReserveRounds: 16,
};

function owner(spentRounds = 0, attemptsOfBranch = 0): ResearchBudgetOwner {
  const budget = new ResearchBudgetOwner(limits, () => 0);
  const base = emptyBudgetState();
  budget.open({
    ...base,
    consumed: { ...base.consumed, modelRounds: spentRounds, branchAttempts: attemptsOfBranch },
    attemptsByBranch: { "branch-1": attemptsOfBranch },
  });
  return budget;
}

describe("research budget owner", () => {
  it("grants the last attempt of a branch below its cap", () => {
    const result = owner(0, 1).allocate("w-1", "branch-1");
    expect(result).toMatchObject({ ok: true, allocation: { attempt: 2, modelRounds: 12 } });
  });

  it("denies an attempt at the branch cap without closing the budget", () => {
    const budget = owner(0, 2);
    expect(budget.allocate("w-1", "branch-1")).toEqual({ ok: false, dimension: "branch-attempts" });
    expect(budget.snapshot().closed).toBeNull();
  });

  it("counts the attempts of each attempt key apart from the branch it belongs to", () => {
    const budget = owner(0, 2);
    expect(budget.allocate("w-1", "branch-1", "test-1").ok).toBe(true);
    expect(budget.allocate("w-2", "branch-1", "test-1").ok).toBe(true);
    expect(budget.allocate("w-3", "branch-1", "test-1")).toEqual({
      ok: false,
      dimension: "branch-attempts",
    });
  });

  it("charges a discovery round from the gather pool, never from the finalization reserve", () => {
    const budget = owner(23);
    expect(budget.spendDiscovery(1)).toBe(true);
    expect(budget.spendDiscovery(1)).toBe(false);
    expect(budget.snapshot().consumed.modelRounds).toBe(24);
  });

  it("grants the single round left outside the finalization reserve", () => {
    expect(owner(23).allocate("w-1", "branch-1")).toMatchObject({
      ok: true,
      allocation: { modelRounds: 1 },
    });
  });

  it("keeps the finalization reserve away from gathering and closes the budget", () => {
    const budget = owner(24);
    expect(budget.allocate("w-1", "branch-1")).toEqual({ ok: false, dimension: "modelRounds" });
    expect(budget.snapshot().closed).toEqual({ reason: "exhausted", dimension: "modelRounds" });
    expect(budget.spendFinalization(1)).toBe(true);
  });

  it("waits for searches and rounds held by open allocations instead of closing the budget", () => {
    const budget = new ResearchBudgetOwner({ ...limits, searchesTotal: 20 }, () => 0, 1);
    budget.open(null);
    const settle = (result: ReturnType<typeof budget.allocate>, searches: number) =>
      budget.settle(result.ok ? result.allocation : (undefined as never), {
        modelRounds: 12,
        searches,
        evidenceItems: 0,
      });
    const first = budget.allocate("w-1", "branch-1");
    expect(budget.allocate("w-2", "branch-2")).toEqual({ ok: false, dimension: "reserved" });
    settle(first, 19);
    const second = budget.allocate("w-2", "branch-2");
    expect(second).toMatchObject({ ok: true, allocation: { searches: 1 } });
    expect(budget.allocate("w-3", "branch-3")).toEqual({ ok: false, dimension: "reserved" });
    expect(budget.snapshot().closed).toBeNull();
    settle(second, 1);
    expect(budget.allocate("w-3", "branch-3")).toEqual({ ok: false, dimension: "modelRounds" });
  });

  it("consumes in full an allocation a dead turn left open", () => {
    const budget = new ResearchBudgetOwner(limits, () => 0);
    const allocation = {
      workId: "w-1",
      branchId: "branch-1",
      attempt: 1,
      modelRounds: 12,
      searches: 9,
    };
    const reclaimed = budget.open({ ...emptyBudgetState(), openAllocations: [allocation] });
    expect(reclaimed).toEqual([allocation]);
    expect(budget.snapshot()).toMatchObject({
      consumed: { modelRounds: 12, searches: 9 },
      openAllocations: [],
    });
  });

  it("shares the searches over the enabled branches of the plan", () => {
    const budget = new ResearchBudgetOwner(limits, () => 0, 2);
    budget.open(null);
    expect(budget.allocate("w-1", "branch-1")).toMatchObject({ allocation: { searches: 30 } });
  });

  it("closes the budget for time when an attempt is asked for past the time limit", () => {
    let now = 0;
    const budget = new ResearchBudgetOwner(limits, () => now);
    budget.open(null);
    now = limits.activeExecutionMs;
    expect(budget.allocate("w-1", "branch-1")).toEqual({ ok: false, dimension: "closed" });
    expect(budget.snapshot().closed).toEqual({ reason: "time", dimension: null });
  });
});

describe("research budget limits", () => {
  it("grows the shared totals per added branch and the attempts of plans that test hypotheses", () => {
    const branches = Array.from({ length: 11 }, (_, index) =>
      researchBranch(index + 1, { enabled: index !== 0 }),
    );
    const preset = presetLimits("balanced");
    expect(budgetLimits(researchPlan(branches.slice(0, 4), "conservative"))).toEqual({
      ...presetLimits("conservative"),
      childSessions: 3,
    });
    expect(budgetLimits(researchPlan(branches.slice(0, 7), "balanced"))).toEqual({
      ...preset,
      childSessions: 6,
      attemptsPerBranch: 3,
      attemptsTotal: 11,
    });
    expect(budgetLimits(researchPlan(branches.slice(0, 11), "balanced"))).toEqual({
      ...preset,
      childSessions: 10,
      attemptsPerBranch: 3,
      attemptsTotal: 18,
      modelRoundsTotal: 267,
      searchesTotal: 100,
      evidenceItemsTotal: 200,
      activeExecutionMs: 50 * 60_000,
    });
  });
});
