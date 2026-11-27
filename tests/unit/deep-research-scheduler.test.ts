import { createResearchLabelCatalogue } from "@adapters/i18n";
import { label } from "@core/research/deepResearch";
import { ENGLISH_RESEARCH_LABELS } from "@core/research/deepResearch";
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
  budgetLimits,
  type BranchExecution,
  initialExecutions,
  isPlanStale,
  nextReadyExecution,
  reportDecision,
  SOURCE_READING_INSTRUCTION,
  branchLanguageInstruction,
} from "@core/research/deepResearch";
import { researchBranch, researchPlan } from "../support/deepResearch";
import { retrieved, webSource } from "../support/factories";
import { runSummary } from "../support/subAgentInspection";
import { settle } from "../support/async";
import { runPastDeadline } from "../support/timers";
import {
  STOP_SETTLE_MS,
  type ResearchSchedulerRunners,
} from "@application/use-cases/research/deep-research/ResearchScheduler";

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

const RU_LABELS = createResearchLabelCatalogue().labelsFor("ru");

describe("deep research scheduling rules", () => {
  it("blocks the dependants of a failed branch while a skipped optional one blocks nothing", () => {
    const executions = blockDependants(
      settled({ "branch-1": "failed", "branch-3": "skipped" }),
      plan,
      RU_LABELS,
    );
    expect(executions.map((execution) => execution.state)).toEqual([
      "failed",
      "blocked",
      "skipped",
      "pending",
    ]);
    expect(executions[1]!.terminalReason).toBe(
      label(RU_LABELS, "dependsOnFailed", { title: plan.branches[0]!.title }),
    );
    expect(nextReadyExecution(executions, plan)?.branchId).toBe("branch-4");
  });

  it("reports partial when a required branch is missing and failed when none completed", () => {
    expect(
      reportDecision(
        plan,
        settled({ "branch-1": "completed", "branch-3": "completed" }),
        "Stop.",
        ENGLISH_RESEARCH_LABELS,
      ),
    ).toMatchObject({
      kind: "report",
      quality: "partial",
      completedBranches: ["branch-1", "branch-3"],
      missingBranches: [
        { branchId: "branch-2", title: "Branch 2" },
        { branchId: "branch-4", title: "Branch 4" },
      ],
    });
    expect(
      reportDecision(plan, settled({ "branch-1": "failed" }), "Stop.", ENGLISH_RESEARCH_LABELS),
    ).toEqual({
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

describe("deep research child session scheduling", () => {
  const finding = { text: "F", citationTokens: [], partial: false };
  const gatherWorks = (plan: ReturnType<typeof researchPlan>) =>
    plan.branches.map((branch) => ({
      workId: `${branch.branchId}-gather-1`,
      branchId: branch.branchId,
      cycle: 1,
      kind: "gather" as const,
      task: "T",
    }));
  const schedulerFor = (
    plan: ReturnType<typeof researchPlan>,
    owner: ResearchBudgetOwner,
    runners: ResearchSchedulerRunners,
    waveSize: number,
    barrier: (executions: readonly BranchExecution[]) => Promise<void> = async () => undefined,
  ) =>
    new ResearchScheduler({
      plan,
      executions: initialExecutions(plan),
      owner,
      runners,
      waveSize,
      signal: new AbortController().signal,
      setTimer: () => () => undefined,
      barrier,
    });

  it("starts every free slot in one step and lets the branches beyond the wave wait for a slot", async () => {
    const grown = researchPlan(
      Array.from({ length: 5 }, (_, index) => researchBranch(index + 1)),
      "conservative",
      { approvedAt: "2026-01-01T00:00:00.000Z" },
    );
    const owner = new ResearchBudgetOwner(budgetLimits(grown), () => 0, 5);
    owner.open(null);
    let active = 0;
    let peak = 0;
    const started: string[] = [];
    const tasks: string[] = [];
    const releases: (() => void)[] = [];
    const child: BranchRunner = {
      path: "sub-agent",
      run: (work) => {
        started.push(work.branchId);
        tasks.push(work.task);
        active += 1;
        peak = Math.max(peak, active);
        return new Promise((resolve) =>
          releases.push(() => {
            active -= 1;
            resolve(finding);
          }),
        );
      },
    };
    const barriers: string[][] = [];
    const running = schedulerFor(
      grown,
      owner,
      { main: { path: "main", run: () => Promise.reject(new Error("unused")) }, subAgent: child },
      3,
      async (executions) => {
        barriers.push(
          executions.filter((entry) => entry.state === "running").map((entry) => entry.branchId),
        );
      },
    ).run(gatherWorks(grown));
    await settle();

    expect(started).toEqual(["branch-1", "branch-2", "branch-3"]);
    expect(barriers[0]).toEqual(["branch-1", "branch-2", "branch-3"]);
    releases[0]!();
    await settle();
    expect(started).toEqual(["branch-1", "branch-2", "branch-3", "branch-4"]);
    while (releases.length > 0 && started.length < 5) {
      releases.shift()!();
      await settle();
    }
    for (const release of releases) release();
    const executions = await running;

    expect(peak).toBe(3);
    expect(new Set(tasks)).toEqual(
      new Set([`T\n\n${SOURCE_READING_INSTRUCTION}\n\n${branchLanguageInstruction("en")}`]),
    );
    expect(executions.map((entry) => [entry.state, entry.path])).toEqual(
      Array(5).fill(["completed", "sub-agent"]),
    );
  });

  it("runs the works one at a time on the main path when no sub-agent runner exists", async () => {
    const two = researchPlan([researchBranch(1), researchBranch(2)], "balanced", {
      approvedAt: "2026-01-01T00:00:00.000Z",
    });
    const owner = new ResearchBudgetOwner(budgetLimits(two), () => 0, 2);
    owner.open(null);
    let active = 0;
    let peak = 0;
    const main: BranchRunner = {
      path: "main",
      run: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await settle();
        active -= 1;
        return finding;
      },
    };
    const executions = await schedulerFor(two, owner, { main }, 2).run(gatherWorks(two));

    expect(peak).toBe(1);
    expect(executions.map((entry) => entry.path)).toEqual(["main", "main"]);
  });

  it.each([
    ["renews the session once and charges the allocation once", 1, "completed", 2],
    [
      "stops renewing a session that is refused again and fails the attempt normally",
      100,
      "failed",
      4,
    ],
  ])("%s", async (_name, refusals, state, runs) => {
    const one = researchPlan([researchBranch(1)], "balanced", {
      approvedAt: "2026-01-01T00:00:00.000Z",
    });
    const owner = new ResearchBudgetOwner(budgetLimits(one), () => 0, 1);
    owner.open(null);
    const released: string[] = [];
    let calls = 0;
    const child: BranchRunner = {
      path: "sub-agent",
      run: () => {
        calls += 1;
        return calls <= refusals
          ? Promise.reject(new UnusableBranchSessionError("s-1"))
          : Promise.resolve(finding);
      },
      usage: () => ({ modelRounds: 3, searches: 1, evidenceItems: 0 }),
    };
    const executions = await schedulerFor(
      one,
      owner,
      {
        main: { path: "main", run: () => Promise.reject(new Error("unused")) },
        subAgent: child,
        releaseSession: (branchId) => released.push(branchId),
      },
      1,
    ).run(gatherWorks(one));

    expect(executions[0]).toMatchObject({ state, path: "sub-agent" });
    expect(calls).toBe(runs);
    expect(released.every((branchId) => branchId === "branch-1")).toBe(true);
    expect(released.length).toBeGreaterThan(0);
    if (state === "completed") {
      expect(executions[0]!.attempts).toBe(1);
      expect(owner.snapshot().consumed).toMatchObject({ branchAttempts: 1, modelRounds: 3 });
    }
  });

  it.each([
    ["a user stop rethrows", false],
    ["a time-limit closure ends the run", true],
  ])(
    "abandons a child that never settles after the abort, charges its allocation: %s",
    async (_case, timeLimit) => {
      const single = researchPlan([researchBranch(1)], "balanced", {
        approvedAt: "2026-01-01T00:00:00.000Z",
      });
      const owner = new ResearchBudgetOwner(single.limits, () => 0, 1);
      owner.open(null);
      const stop = new AbortController();
      const child: BranchRunner = {
        path: "sub-agent",
        run: () => {
          if (timeLimit) owner.close("time");
          stop.abort(new DOMException("Stopped", "AbortError"));
          return new Promise(() => undefined);
        },
      };
      const scheduler = new ResearchScheduler({
        plan: single,
        executions: initialExecutions(single),
        owner,
        runners: { main: child, subAgent: child },
        waveSize: 1,
        signal: stop.signal,
        setTimer: (delayMs, callback) => {
          const handle = setTimeout(callback, delayMs);
          return () => clearTimeout(handle);
        },
        barrier: async () => undefined,
      });
      const outcome = await runPastDeadline(STOP_SETTLE_MS, () =>
        scheduler
          .run([
            {
              workId: "branch-1-gather-1",
              branchId: "branch-1",
              cycle: 1,
              kind: "gather",
              task: "T",
            },
          ])
          .catch((error: unknown) => error),
      );
      await scheduler.drain();

      expect(outcome instanceof DOMException).toBe(!timeLimit);
      const snapshot = owner.snapshot();
      expect(snapshot.openAllocations).toEqual([]);
      expect(snapshot.consumed.modelRounds).toBe(single.limits.modelRoundsPerAttempt);
    },
  );

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

  it.each([
    ["counts the search calls the child reported", { searchCalls: 2 }, 2],
    ["falls back to every tool call for a child stored without a search count", {}, 3],
  ])(
    "%s and the documents it opened as the fetches of its attempt",
    async (_name, extra, searches) => {
      const toolCounts = { search_web: 2, fetch_web_page: 1 };
      const run = runSummary("r-1", "s-1", {
        usage: {
          requestCount: 1,
          modelRounds: 2,
          toolCalls: 3,
          toolCounts,
          durationMs: 1,
          source: "provider",
          ...extra,
        },
      });
      const delegator = {
        create: async () => ({ subAgentSessionId: "s-1" }),
        run: async () => ({ sessionId: "s-1", runId: "r-1" }),
        getResult: async () => ({
          state: "completed",
          resultRevision: 1,
          outcome: {
            run,
            answerText: "Opened [chunk-1] and heard [chunk-2].",
            importId: "import-1",
            evidence: ["chunk-1", "chunk-2"].map((id) => ({
              conversationEvidenceId: id,
              conversationRevisionId: `${id}:revision-1`,
            })),
          },
        }),
      } as unknown as SubAgentDelegator;
      const call = (tool: "fetch_web_page" | "search_web") => ({ callId: "c", tool });
      const runner = new SubAgentBranchRunner({
        branches: [researchBranch(1)],
        delegator: () => delegator,
        resolver: {
          resolve: async () => ({
            evidence: [
              retrieved("chunk-1", webSource("https://e.test/opened"), "A"),
              retrieved("chunk-3", webSource("https://e.test/uncited"), "C"),
              retrieved("chunk-2", webSource("https://e.test/cited"), "B"),
            ],
            citations: [],
            provenance: [
              { evidenceId: "chunk-1", calls: [call("fetch_web_page")] },
              { evidenceId: "chunk-3", calls: [call("search_web")] },
              { evidenceId: "chunk-2", calls: [call("search_web")] },
            ],
          }),
        },
        sessionOf: () => null,
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
        searches: 3,
      };

      const finding = await runner.run(work, allocation, new AbortController().signal);

      expect(finding.unreadSources).toEqual(["https://e.test/cited", "https://e.test/uncited"]);
      expect(runner.usage("w-1")).toEqual({
        modelRounds: 2,
        searches,
        evidenceItems: 0,
        fetches: 1,
        sources: 2,
        toolCounts,
      });
    },
  );

  it("reports the child's import outcome and evidence count after a failed import", async () => {
    const run = runSummary("r-1", "s-1", { status: "failed", evidenceCount: 2 });
    const delegator = {
      create: async () => ({ subAgentSessionId: "s-1" }),
      run: async () => ({ sessionId: "s-1", runId: "r-1" }),
      getResult: async () => ({
        state: "failed",
        resultRevision: 1,
        run,
        error: { code: "import-failed", message: "Import failed." },
      }),
    } as unknown as SubAgentDelegator;
    const runner = new SubAgentBranchRunner({
      branches: [researchBranch(1)],
      delegator: () => delegator,
      resolver: { resolve: () => Promise.reject(new Error("unused")) },
      sessionOf: () => null,
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

    await expect(runner.run(work, allocation, new AbortController().signal)).rejects.toThrow(
      "The child session failed: Import failed.",
    );
    expect(runner.childRun("w-1")).toEqual({ outcome: "import-failed", evidenceCount: 2 });
  });
});
