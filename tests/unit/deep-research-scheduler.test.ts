import {
  UnusableBranchSessionError,
  ResearchScheduler,
  SubAgentBranchRunner,
  type BranchRunner,
} from "@application/use-cases/research/deep-research";
import type { SubAgentDelegator } from "@application/ports/subAgent";
import {
  ResearchBudgetOwner,
  blockDependants,
  initialExecutions,
  isPlanStale,
  nextReadyExecution,
  reportDecision,
} from "@core/research/deepResearch";
import { researchBranch, researchPlan } from "../support/deepResearch";
import { settle } from "../support/async";

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

  it("treats a web plan as stale from exactly 24 hours", () => {
    const web = researchPlan([researchBranch(1, { sourceScope: "webOnly" })], "thorough", {
      approvedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(isPlanStale(web, "2026-01-01T23:59:59.999Z")).toBe(false);
    expect(isPlanStale(web, "2026-01-02T00:00:00.000Z")).toBe(true);
  });

  it("treats an index plan as stale from exactly seven days, also with a disabled web branch", () => {
    const mixed = researchPlan(
      [researchBranch(1), researchBranch(2, { sourceScope: "webOnly", enabled: false })],
      "thorough",
      { approvedAt: "2026-01-01T00:00:00.000Z" },
    );
    expect(isPlanStale(mixed, "2026-01-07T23:59:59.999Z")).toBe(false);
    expect(isPlanStale(mixed, "2026-01-08T00:00:00.000Z")).toBe(true);
  });
});

describe("deep research main-path fallback", () => {
  it("queues a refused session behind a running main-path work and charges its allocation once", async () => {
    const fallbackPlan = researchPlan([researchBranch(1), researchBranch(2)], "balanced", {
      approvedAt: "2026-01-01T00:00:00.000Z",
    });
    const limits = { ...fallbackPlan.limits, childSessions: 1 };
    const owner = new ResearchBudgetOwner(limits, () => 0, 2);
    owner.open(null);
    let release: () => void = () => undefined;
    const mainRuns: string[] = [];
    const main: BranchRunner = {
      path: "main",
      run: (work) => {
        mainRuns.push(work.branchId);
        const finding = { text: "F", citationTokens: [], partial: false };
        if (work.branchId === "branch-2") return Promise.resolve(finding);
        return new Promise((resolve) => (release = () => resolve(finding)));
      },
      usage: () => ({ modelRounds: 3, searches: 1, evidenceItems: 0 }),
    };
    const child: BranchRunner = {
      path: "sub-agent",
      run: () => Promise.reject(new UnusableBranchSessionError("s-2")),
    };
    const running = new ResearchScheduler({
      plan: { ...fallbackPlan, limits },
      executions: initialExecutions(fallbackPlan),
      owner,
      runners: { main, subAgent: child, sessionByBranch: () => ({ "branch-2": "s-2" }) },
      waveSize: 2,
      signal: new AbortController().signal,
      barrier: async () => undefined,
    }).run(
      ["branch-1", "branch-2"].map((branchId) => ({
        workId: `${branchId}-gather-1`,
        branchId,
        cycle: 1,
        kind: "gather" as const,
        task: "T",
      })),
    );
    await settle();
    expect(mainRuns).toEqual(["branch-1"]);
    release();
    const executions = await running;

    expect(mainRuns).toEqual(["branch-1", "branch-2"]);
    expect(executions.map((entry) => [entry.state, entry.path, entry.attempts])).toEqual([
      ["completed", "main", 1],
      ["completed", "main", 1],
    ]);
    expect(owner.snapshot().consumed).toMatchObject({ branchAttempts: 2, modelRounds: 6 });
    expect(owner.snapshot().openAllocations).toEqual([]);
  });

  it("leaves a queued fallback's allocation open exactly once when the user stops", async () => {
    const fallbackPlan = researchPlan([researchBranch(1), researchBranch(2)], "balanced", {
      approvedAt: "2026-01-01T00:00:00.000Z",
    });
    const limits = { ...fallbackPlan.limits, childSessions: 1 };
    const owner = new ResearchBudgetOwner(limits, () => 0, 2);
    owner.open(null);
    const stop = new AbortController();
    const main: BranchRunner = {
      path: "main",
      run: (_work, _allocation, signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError"))),
        ),
    };
    const child: BranchRunner = {
      path: "sub-agent",
      run: () => Promise.reject(new UnusableBranchSessionError("s-2")),
    };
    const running = new ResearchScheduler({
      plan: { ...fallbackPlan, limits },
      executions: initialExecutions(fallbackPlan),
      owner,
      runners: { main, subAgent: child, sessionByBranch: () => ({ "branch-2": "s-2" }) },
      waveSize: 2,
      signal: stop.signal,
      barrier: async () => undefined,
    }).run(
      ["branch-1", "branch-2"].map((branchId) => ({
        workId: `${branchId}-gather-1`,
        branchId,
        cycle: 1,
        kind: "gather" as const,
        task: "T",
      })),
    );
    await settle();
    stop.abort();
    await expect(running).rejects.toMatchObject({ name: "AbortError" });

    const snapshot = owner.snapshot();
    expect(snapshot.openAllocations.map((entry) => entry.branchId)).toEqual([
      "branch-1",
      "branch-2",
    ]);
    expect(snapshot.consumed).toMatchObject({ branchAttempts: 2, modelRounds: 0 });
    const next = new ResearchBudgetOwner(limits, () => 0, 2);
    next.open(snapshot);
    expect(next.snapshot().consumed.modelRounds).toBe(
      snapshot.openAllocations.reduce((total, entry) => total + entry.modelRounds, 0),
    );
  });

  it("refuses a mapped session that the chat lists as stopped without contacting it", async () => {
    const calls: string[] = [];
    const delegator = new Proxy({} as SubAgentDelegator, {
      get: (_target, name) => () => {
        calls.push(String(name));
        return Promise.reject(new Error("unexpected"));
      },
    });
    const runner = new SubAgentBranchRunner({
      branches: [researchBranch(1)],
      delegator: () => delegator,
      resolver: { resolve: () => Promise.reject(new Error("unused")) },
      sessionOf: () => "s-1",
      listSessions: async () => [
        { sessionId: "s-1", title: "B", state: "stopped", lastRunId: "r-1", attempt: 1 },
      ],
    });
    const work = {
      workId: "w-1",
      branchId: "branch-1",
      cycle: 1,
      kind: "gather" as const,
      task: "T",
    };
    const allocation = {
      workId: "w-1",
      branchId: "branch-1",
      attempt: 1,
      modelRounds: 3,
      searches: 1,
    };

    await expect(runner.run(work, allocation, new AbortController().signal)).rejects.toBeInstanceOf(
      UnusableBranchSessionError,
    );
    expect(calls).toEqual([]);
  });
});
