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
import { STOP_SETTLE_MS } from "@application/use-cases/research/deep-research/ResearchScheduler";

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
    const tasks: string[] = [];
    const main: BranchRunner = {
      path: "main",
      run: (work) => {
        mainRuns.push(work.branchId);
        tasks.push(work.task);
        const finding = { text: "F", citationTokens: [], partial: false };
        if (work.branchId === "branch-2") return Promise.resolve(finding);
        return new Promise((resolve) => (release = () => resolve(finding)));
      },
      usage: () => ({ modelRounds: 3, searches: 1, evidenceItems: 0 }),
    };
    const child: BranchRunner = {
      path: "sub-agent",
      run: (work) => {
        tasks.push(work.task);
        return Promise.reject(new UnusableBranchSessionError("s-2"));
      },
    };
    const running = new ResearchScheduler({
      plan: { ...fallbackPlan, limits },
      executions: initialExecutions(fallbackPlan),
      owner,
      runners: { main, subAgent: child, sessionByBranch: () => ({ "branch-2": "s-2" }) },
      waveSize: 2,
      signal: new AbortController().signal,
      setTimer: () => () => undefined,
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
    expect(tasks).toEqual(
      Array(3).fill(`T\n\n${SOURCE_READING_INSTRUCTION}\n\n${branchLanguageInstruction("en")}`),
    );
  });

  it("opens child sessions for branches added beyond the preset before using the main path", async () => {
    const grown = researchPlan(
      Array.from({ length: 5 }, (_, index) => researchBranch(index + 1)),
      "conservative",
      { approvedAt: "2026-01-01T00:00:00.000Z" },
    );
    const owner = new ResearchBudgetOwner(grown.limits, () => 0, 5);
    owner.open(null);
    const finding = { text: "F", citationTokens: [], partial: false };
    const runner = (path: "main" | "sub-agent"): BranchRunner => ({
      path,
      run: () => Promise.resolve(finding),
    });
    const executions = await new ResearchScheduler({
      plan: grown,
      executions: initialExecutions(grown),
      owner,
      runners: {
        main: runner("main"),
        subAgent: runner("sub-agent"),
        sessionByBranch: () => ({}),
      },
      waveSize: 5,
      signal: new AbortController().signal,
      setTimer: () => () => undefined,
      barrier: async () => undefined,
    }).run(
      grown.branches.map((branch) => ({
        workId: `${branch.branchId}-gather-1`,
        branchId: branch.branchId,
        cycle: 1,
        kind: "gather" as const,
        task: "T",
      })),
    );

    expect(executions.map((entry) => entry.path)).toEqual([
      "sub-agent",
      "sub-agent",
      "sub-agent",
      "sub-agent",
      "main",
    ]);
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
      setTimer: () => () => undefined,
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
        runners: { main: child, subAgent: child, sessionByBranch: () => ({}) },
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
