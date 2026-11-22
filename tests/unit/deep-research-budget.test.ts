import {
  ResearchBudgetOwner,
  emptyBudgetState,
  presetLimits,
  type ResearchLimits,
} from "@core/research/deepResearch";

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
