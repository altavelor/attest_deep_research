import {
  DeepResearchStrategy,
  MainBranchRunner,
} from "@application/use-cases/research/deep-research";
import { boundFindingText } from "@core/research/deepResearch";
import { markdownSource, retrieved } from "../support/factories";
import type { ResearchExecutionContext } from "@application/use-cases/research/strategies/ResearchStrategy";
import { collectAsync } from "../support/async";
import {
  MemoryResearchState,
  deepResearchService,
  pausedResearch,
  pendingResearch,
  planReply,
} from "../support/deepResearch";
import type { ResearchState } from "@core/research/deepResearch";
import { FakeChatModel } from "../support/researchFakes";

describe("deep research strategy", () => {
  it("ends the research as failed with a bounded reason when the provider error is huge", async () => {
    const port = new MemoryResearchState();
    const strategy = new DeepResearchStrategy({
      chatModel: {
        listModels: async () => [],
        async *streamChat() {
          throw new Error("x".repeat(5000));
        },
      },
      chatModelName: "model",
      chatOptions: {},
      toolCapabilities: {
        calls: true,
        choiceRequired: true,
        choiceSpecific: true,
        parallelCalls: false,
      },
      hasIndex: true,
      hasWeb: false,
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      createBranchEngine: () => ({ run: () => Promise.reject(new Error("unused")) }),
      branchSources: {},
    });
    const ctx = {
      request: { question: "Question", researchState: port },
      question: "Question",
      searchMode: "indexOnly",
    } as unknown as ResearchExecutionContext;

    await expect(collectAsync(strategy.execute(ctx))).rejects.toThrow(
      "The plan could not be generated",
    );
    const ended = port.commits.at(-1)!;
    expect(ended.phase).toBe("failed");
    expect(ended.terminalReason!.length).toBeLessThanOrEqual(500);
  });

  it("refuses a saved deep-research mode without contacting the model when the flag is off", async () => {
    const model = new FakeChatModel();
    const answer = deepResearchService(model, false).answer({
      question: "Q",
      mode: "deep-research",
    });
    await expect(collectAsync(answer)).rejects.toMatchObject({
      message: "Deep Research is not enabled.",
      details: { reason: "research-disabled" },
    });
    expect(model.requests).toHaveLength(0);
  });

  it("rejects an over-long question readably before any state commit", async () => {
    const port = new MemoryResearchState();
    const model = new FakeChatModel();
    const answer = deepResearchService(model).answer({
      question: "q".repeat(20_001),
      mode: "deep-research",
      researchState: port,
    });
    await expect(collectAsync(answer)).rejects.toMatchObject({
      message: "The research question is too long; keep it under 20,000 characters.",
      details: { reason: "research-input-too-long" },
    });
    expect(port.commits).toHaveLength(0);
  });

  it("rejects an over-long plain-text plan instruction readably", async () => {
    const port = new MemoryResearchState();
    port.commits.push(pendingResearch());
    const answer = deepResearchService(new FakeChatModel()).answer({
      question: "i".repeat(4001),
      mode: "deep-research",
      researchState: port,
    });
    await expect(collectAsync(answer)).rejects.toThrow("plan instruction is too long");
    expect(port.commits).toHaveLength(1);
  });
});

function staleTurn(state: ResearchState, payload: unknown, model = new FakeChatModel()) {
  const port = new MemoryResearchState();
  port.commits.push(state);
  const answer = deepResearchService(model).answer({
    question: "Decide",
    mode: "deep-research",
    researchState: port,
    research: {
      type: "decision",
      decision: {
        researchId: state.researchId,
        decisionId: "decision-stale",
        expectedRevision: state.revision,
        payload,
      },
    },
  });
  return { port, model, events: collectAsync(answer) };
}

describe("deep research stale plan", () => {
  it("asks about an old plan on continue without contacting the model", async () => {
    const port = new MemoryResearchState();
    const paused = pausedResearch();
    port.commits.push(paused);
    const model = new FakeChatModel();
    await collectAsync(
      deepResearchService(model).answer({
        question: "Continue",
        mode: "deep-research",
        researchState: port,
        research: { type: "continue", researchId: paused.researchId },
      }),
    );
    expect(port.commits.at(-1)!.pending?.kind).toBe("stale-plan");
    expect(model.requests).toHaveLength(0);
  });

  it("continues anyway by clearing the decision and running the research", async () => {
    const { port, events } = staleTurn(pausedResearch(true), { action: "continue" });
    await events;
    expect(port.commits[1]).toMatchObject({ pending: null, phase: "gathering" });
    expect(port.commits.at(-1)!.phase).toBe("completed");
  });

  it("replans into a new plan for review with no executions and the same budget", async () => {
    const paused = pausedResearch(true);
    const model = new FakeChatModel([{ content: planReply(), isComplete: true }]);
    const { port, events } = staleTurn(paused, { action: "replan" }, model);
    await events;
    expect(port.commits.at(-1)).toMatchObject({
      phase: "awaiting-approval",
      executions: [],
      budget: { consumed: paused.budget!.consumed },
      plan: { approvedAt: null, generationsUsed: 2 },
    });
  });

  it("cancels the research from the stale-plan decision", async () => {
    const { port, events } = staleTurn(pausedResearch(true), { action: "cancel" });
    await events;
    expect(port.commits.at(-1)!.phase).toBe("cancelled");
  });

  it("refuses a replan it cannot run and a malformed choice without spending a generation", async () => {
    const closed = pausedResearch(true);
    const rows: [ResearchState, unknown, string][] = [
      [
        pausedResearch(true, { generationsUsed: 3 }),
        { action: "replan" },
        "No plan generations remain",
      ],
      [
        {
          ...closed,
          budget: { ...closed.budget!, closed: { reason: "exhausted", dimension: "searches" } },
        },
        { action: "replan" },
        "The research budget is closed",
      ],
      [closed, { action: "later" }, "The decision is malformed."],
    ];
    for (const [state, payload, message] of rows) {
      const { port, model, events } = staleTurn(state, payload);
      await expect(events, message).rejects.toThrow(message);
      expect(port.commits).toHaveLength(1);
      expect(model.requests).toHaveLength(0);
    }
  });
});

describe("main branch runner findings", () => {
  it("lists only the citations left in the finding after it is cut to its bound", async () => {
    const kept = retrieved("chunk-kept-1", markdownSource("a.md"), "Kept");
    const cut = retrieved("chunk-cut-2", markdownSource("b.md"), "Cut");
    const runner = new MainBranchRunner({
      engine: {
        run: async () => ({
          answerText: `Kept [${kept.id}]. ${"x".repeat(30_000)} Cut [${cut.id}].`,
          snapshot: { evidence: [kept, cut], citations: [], provenance: [] },
        }),
      },
      sources: {},
      web: { deadlineMs: 1, perSourceLimit: 1, mergedLimit: 1, maxConcurrentSources: 1 },
      chatScope: "indexOnly",
      branches: pendingResearch().plan!.branches,
      now: () => new Date("2026-01-01T00:00:00.000Z"),
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
      modelRounds: 2,
      searches: 2,
    };
    const finding = await runner.run(work, allocation, new AbortController().signal);
    expect(finding.text).toHaveLength(30_000);
    expect(finding.citationTokens).toEqual([kept.id]);
  });

  it("cuts a finding whose stored encoding would exceed the byte bound", () => {
    const bounded = boundFindingText("\u0001".repeat(20_000));
    expect(new TextEncoder().encode(JSON.stringify(bounded)).length).toBeLessThanOrEqual(48 * 1024);
    expect(bounded.length).toBeGreaterThan(8_000);
  });
});
