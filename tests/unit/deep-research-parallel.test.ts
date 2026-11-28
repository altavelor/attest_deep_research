import { ENGLISH_RESEARCH_LABELS } from "@core/research/deepResearch";
import {
  BranchUnavailableError,
  ResearchBudgetPermits,
  ResearchScheduler,
  ResearchScopeRouter,
  type BranchRunner,
  RESEARCH_BRANCH_MAX_RESULT_CHARS,
} from "@application/use-cases/research/deep-research";
import type { ReportSynthesisService } from "@application/use-cases/research/deep-research/ReportSynthesisService";
import { runResearch } from "@application/use-cases/research/deep-research/researchRun";
import { researchGrant } from "@application/use-cases/chat/researchGrant";
import {
  MemoryResearchState,
  gatheringResearch,
  researchBranch,
  researchPlan,
} from "../support/deepResearch";
import {
  ResearchBudgetOwner,
  initialExecutions,
  presetLimits,
  researchScopeId,
  type ResearchState,
} from "@core/research/deepResearch";

const limits = presetLimits("balanced");

function permits(owner = new ResearchBudgetOwner(limits, () => 0, 2)) {
  owner.open(null);
  return new ResearchBudgetPermits({
    researchId: "research-1",
    owner,
    sessionCeiling: limits.childSessions,
    sessionByBranch: {},
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });
}

describe("deep research budget scopes", () => {
  it("refuses unknown and foreign scopes instead of treating them as local", async () => {
    const router = new ResearchScopeRouter();
    router.attach(permits());
    for (const scope of ["scope-1", researchScopeId("research-2", "branch-1")]) {
      await expect(router.beginSessionRegistration(scope, "c-1"), scope).rejects.toThrow(
        "The budget scope belongs to no active research of this chat.",
      );
    }
    const own = await router.beginSessionRegistration(
      researchScopeId("research-1", "branch-1"),
      "c-1",
    );
    expect(own.type).toBe("registered");
  });

  it("registers one session per branch at a time, also while its first registration is open", async () => {
    const port = permits();
    const scope = researchScopeId("research-1", "branch-1");
    const first = await port.beginSessionRegistration(scope, "c-1");

    await expect(port.beginSessionRegistration(scope, "c-2")).rejects.toThrow(
      "The research has no child session left for this branch.",
    );
    if (first.type !== "registered") throw new Error("not registered");
    await port.finishSessionRegistration(first.registration, {
      type: "published",
      sessionId: "session-1",
    });
    port.releaseSession("branch-1");
    expect((await port.beginSessionRegistration(scope, "c-3")).type).toBe("registered");
  });

  it("grants one execution permit per open allocation and replays it for the same key", async () => {
    const owner = new ResearchBudgetOwner(limits, () => 0, 2);
    const port = permits(owner);
    owner.allocate("w-1", "branch-1");
    const scope = researchScopeId("research-1", "branch-1");

    const first = await port.beginExecution(scope, "key-1");
    const replay = await port.beginExecution(scope, "key-1");
    const second = await port.beginExecution(scope, "key-2");

    expect(replay).toEqual(first);
    expect(first.type).toBe("granted");
    expect(second.type).toBe("work-denied");
    expect(owner.snapshot().consumed.branchAttempts).toBe(1);
  });

  it("charges only document reads and lets the first cleanup claim of each scope win", async () => {
    const owner = new ResearchBudgetOwner({ ...limits, evidenceItemsTotal: 1 }, () => 0, 2);
    const port = permits(owner);
    const [a, b] = ["branch-1", "branch-2"].map((id) => researchScopeId("research-1", id));
    const searched = await port.reserve(a!, {
      actionKey: "append-0",
      action: "evidence-append",
      units: { evidenceItems: 30, documentReads: 0 },
    });
    const denied = await port.reserve(a!, {
      actionKey: "append-1",
      action: "evidence-append",
      units: { evidenceItems: 2, documentReads: 2 },
    });
    const closureId = denied.type === "denied" ? denied.closureId : "none";

    const claims = [
      await port.claimClosureCleanup(a!, closureId),
      await port.claimClosureCleanup(b!, closureId),
      await port.claimClosureCleanup(a!, closureId),
    ];

    expect(searched.type).toBe("granted");
    expect(denied.type).toBe("denied");
    expect(claims).toEqual([true, true, false]);
    expect(await port.beginExecution(b!, "key-after")).toMatchObject({ type: "denied", closureId });
  });
});

describe("deep research waves", () => {
  it("aborts and waits for sibling attempts when a barrier commit fails mid-wave", async () => {
    const state = gatheringResearch(
      researchPlan([researchBranch(1), researchBranch(2)], "balanced"),
    );
    const signals: AbortSignal[] = [];
    let siblingSettled = false;
    const child: BranchRunner = {
      path: "sub-agent",
      run: (work, _allocation, signal) => {
        signals.push(signal);
        if (work.branchId === "branch-1") {
          return Promise.resolve({ text: "F", citationTokens: [], partial: false });
        }
        return new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => {
            siblingSettled = true;
            reject(new DOMException("Stopped", "AbortError"));
          }),
        );
      },
    };
    const port = new MemoryResearchState();
    port.commit = async (next: ResearchState) => {
      if (next.executions.some((entry) => entry.state === "completed")) throw new Error("conflict");
      port.commits.push(next);
    };
    const run = runResearch(state, {
      port,
      runner: { path: "main", run: () => Promise.reject(new Error("unused")) },
      subAgents: { attach: () => () => undefined, createRunner: () => child },
      parallelRequests: true,
      synthesis: {} as ReportSynthesisService,
      labels: ENGLISH_RESEARCH_LABELS,
      now: () => new Date("2026-01-01T01:00:00.000Z"),
      setTimer: () => () => undefined,
      createId: (prefix) => `${prefix}-1`,
      onState: () => undefined,
      onStatus: () => undefined,
    });

    await expect(run).rejects.toThrow("conflict");
    expect(siblingSettled).toBe(true);
    expect(signals).toHaveLength(2);
  });

  it("times a run with branches added above the preset under the grown budget", async () => {
    const branches = Array.from({ length: 7 }, (_, index) => researchBranch(index + 1));
    const port = new MemoryResearchState();
    port.commit = () => Promise.reject(new Error("stop"));
    const delays: number[] = [];
    const run = runResearch(gatheringResearch(researchPlan(branches, "conservative")), {
      port,
      runner: { path: "main", run: () => Promise.reject(new Error("unused")) },
      synthesis: {} as ReportSynthesisService,
      labels: ENGLISH_RESEARCH_LABELS,
      now: () => new Date("2026-01-01T01:00:00.000Z"),
      setTimer: (delayMs) => {
        delays.push(delayMs);
        return () => undefined;
      },
      createId: (prefix) => `${prefix}-1`,
      onState: () => undefined,
      onStatus: () => undefined,
    });

    await expect(run).rejects.toThrow("stop");
    expect(delays).toEqual([35 * 60_000]);
  });

  it("saves no run reference to a session the branch no longer maps to", async () => {
    const start = gatheringResearch(researchPlan([researchBranch(1)], "balanced"));
    const earlier = {
      ...start.executions[0]!,
      state: "completed" as const,
      path: "sub-agent" as const,
      finding: { text: "F", citationTokens: [], partial: false },
      runRef: { sessionId: "session-old", runId: "run-1", resultRevision: 1 },
    };
    const saved: ResearchState[] = [];
    const port = new MemoryResearchState();
    port.commit = async (next: ResearchState) => {
      saved.push(next);
      throw new Error("stop");
    };
    await expect(
      runResearch(
        { ...start, executions: [earlier], sessionByBranch: { "branch-1": "session-new" } },
        {
          port,
          runner: { path: "main", run: () => Promise.reject(new Error("unused")) },
          synthesis: {} as ReportSynthesisService,
          labels: ENGLISH_RESEARCH_LABELS,
          now: () => new Date("2026-01-01T01:00:00.000Z"),
          setTimer: () => () => undefined,
          createId: (prefix) => `${prefix}-1`,
          onState: () => undefined,
          onStatus: () => undefined,
        },
      ),
    ).rejects.toThrow("stop");

    expect(saved[0]!.sessionByBranch).toEqual({ "branch-1": "session-new" });
    expect(saved[0]!.executions[0]!.runRef).toBeUndefined();
  });

  it("fails a branch without a source in the chat once, without a retry", async () => {
    const plan = researchPlan([researchBranch(1)], "balanced", {
      approvedAt: "2026-01-01T00:00:00.000Z",
    });
    const owner = new ResearchBudgetOwner(plan.limits, () => 0, 1);
    owner.open(null);
    const executions = await new ResearchScheduler({
      plan,
      executions: initialExecutions(plan),
      owner,
      runners: {
        main: {
          path: "main",
          run: () => Promise.reject(new BranchUnavailableError("No source for this branch.")),
        },
      },
      waveSize: 1,
      signal: new AbortController().signal,
      setTimer: () => () => undefined,
      barrier: async () => undefined,
    }).run([
      { workId: "branch-1-gather-1", branchId: "branch-1", cycle: 1, kind: "gather", task: "T" },
    ]);

    expect(executions).toMatchObject([
      { state: "failed", attempts: 1, terminalReason: ENGLISH_RESEARCH_LABELS.branchUnavailable },
    ]);
  });
});

describe("research branch grant", () => {
  it("narrows a web branch of an index and web chat to the branch scope and allocation", () => {
    const binding = { chatSessionId: "chat-1", parentRunId: "run-1", bindingGeneration: 1 };
    const grant = researchGrant(
      binding,
      {
        searchMode: "indexAndWeb",
        contextPaths: ["Notes"],
        indexScope: "paths",
        allowActiveFile: true,
        allowNoteMutation: true as false,
      },
      researchBranch(1, { sourceScope: "webOnly" }),
      { workId: "w-1", branchId: "branch-1", attempt: 1, modelRounds: 7, searches: 30 },
      "research-1",
    );

    expect(grant).toEqual({
      binding,
      callerMode: "deep-research",
      budgetPolicy: { type: "required-scope", scopeId: "research:research-1:branch-1" },
      maximumSourcePolicy: {
        searchMode: "webOnly",
        contextPaths: ["Notes"],
        indexScope: "none",
        allowActiveFile: false,
        allowNoteMutation: false,
      },
      origin: "direct",
      limits: { maxRounds: 7, maxResultChars: RESEARCH_BRANCH_MAX_RESULT_CHARS, maxSearches: 20 },
    });
    expect(grant.limits.maxResultChars).toBeGreaterThan(30_000);
  });
});
