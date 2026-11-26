import {
  ENGLISH_RESEARCH_LABELS,
  MAX_TEST_FINDING_CHARS,
  MAX_TEST_FINDING_TOKENS,
} from "@core/research/deepResearch";
import type { ResearchRequest } from "@application/contracts/research";
import {
  nextResearchSection,
  validateResearchSection,
  type ResearchState,
} from "@core/research/deepResearch";
import { collectAsync } from "../support/async";
import {
  BranchModelRounds,
  DiscoveryModel,
  MemoryResearchState,
  ResearchRegistry,
  deepResearchService,
  gatheringResearch,
  researchBranch,
  researchPlan,
} from "../support/deepResearch";
import { fixedNow, markdownSource, retrieved } from "../support/factories";
import { FakeRetriever } from "../support/researchFakes";
import {
  ReportSynthesisService,
  ResearchDiscoveryService,
  type BranchRunner,
} from "@application/use-cases/research/deep-research";
import { runResearch } from "@application/use-cases/research/deep-research/researchRun";

function answer(
  model: DiscoveryModel,
  registry: ResearchRegistry,
  request: Omit<ResearchRequest, "mode">,
  rounds = new BranchModelRounds(),
  now: () => Date = fixedNow,
) {
  return collectAsync(
    deepResearchService(model, {
      retriever: new FakeRetriever({
        chunks: [
          retrieved(
            "chunk-tides-1",
            markdownSource("Notes/tides.md"),
            "The moon pulls the oceans and causes tides twice a day.",
          ),
        ],
        citations: [],
        usedFallback: false,
      }),
      modelRound: rounds,
      now,
    }).answer({
      ...request,
      mode: "deep-research",
      finalizeAnswer: registry.finalizeAnswer,
      resolveEvidence: registry.resolveEvidence,
    }),
  );
}

function stored(preset: "balanced" | "thorough"): MemoryResearchState {
  const state = gatheringResearch(researchPlan([researchBranch(1)], preset));
  const port = new MemoryResearchState();
  port.commits.push({ ...state, plan: { ...state.plan!, approvedAt: fixedNow().toISOString() } });
  return port;
}

function reloaded(state: ResearchState): MemoryResearchState {
  const read = validateResearchSection(
    JSON.parse(JSON.stringify({ schema: 1, active: state, history: [] })),
  );
  const port = new MemoryResearchState();
  if (read.ok) port.commits.push(read.value.active!);
  return port;
}

describe("deep research discovery", () => {
  it("tests a hypothesis against sources and revises it across cycles of one budget", async () => {
    const model = new DiscoveryModel(["literature", "literature"], ["inconclusive", "supports"]);
    const port = stored("thorough");
    const researchId = port.commits[0]!.researchId;
    const rounds = new BranchModelRounds();
    const events = await answer(
      model,
      new ResearchRegistry(),
      { question: "Continue", researchState: port, research: { type: "continue", researchId } },
      rounds,
    );
    const steps = events.flatMap((event) =>
      event.type === "research-activity"
        ? [`${event.activity.stage}:${event.activity.step.kind}`]
        : [],
    );
    expect(steps.filter((step, index) => step !== steps[index - 1])).toEqual([
      "hypotheses:proposing",
      "hypotheses:testing",
      "hypotheses:judging",
      "hypotheses:proposing",
      "hypotheses:testing",
      "hypotheses:judging",
      "writing:writing",
    ]);
    const writing = events.flatMap((event) =>
      event.type === "research-activity" && event.activity.step.kind === "writing"
        ? [event.activity.step]
        : [],
    );
    expect(writing[1]).toEqual({ kind: "writing", words: 0, headings: [], thinking: 3 });
    expect(writing.at(-1)).toMatchObject({ headings: ["Report"], thinking: 4 });
    const tests = rounds.tasks.filter((task) => task.startsWith("Test this hypothesis"));
    expect(tests).toHaveLength(2);
    expect(tests[0]).toContain("Claim: The moon causes tides");
    expect(tests[0]).toContain("Disconfirmed if: Tides ignore the moon");

    const discovery = [...port.commits].reverse().find((state) => state.discovery)!.discovery!;
    expect(discovery.hypotheses).toMatchObject([
      { revision: 1, previousRevision: null, status: "inconclusive" },
      { revision: 2, previousRevision: 1, status: "supported" },
    ]);
    expect(discovery.cycles.map((cycle) => cycle.decision)).toEqual([
      "continue",
      "continue",
      "finish",
    ]);
    const final = port.commits.at(-1)!;
    expect(final.phase).toBe("completed");
    const tested = discovery.tests.map((test) => test.testId);
    expect(final.budget!.attemptsByBranch).toEqual({
      "branch-1": 1,
      ...Object.fromEntries(tested.map((testId) => [testId, 1])),
    });
    const request = String(model.requests.at(-1)!.messages.at(-1)!.content);
    expect(request).toContain(
      '<contested outcome="the first position held in the source check">\n<position>The moon causes tides',
    );
    expect(request).toContain("<other-position>Wind causes tides");
    const spent = port.commits.map((state) => state.budget?.consumed.modelRounds ?? 0);
    expect(spent.every((value, index) => index === 0 || value >= spent[index - 1]!)).toBe(true);
    expect(final.budget!.consumed.modelRounds).toBeGreaterThanOrEqual(3 * 2 + 4);
  });

  it("waits for a supplied observation across a reload and resumes once on a valid decision", async () => {
    const model = new DiscoveryModel(["observation"], ["supports"]);
    const registry = new ResearchRegistry();
    const port = stored("balanced");
    const researchId = port.commits[0]!.researchId;
    await answer(model, registry, {
      question: "Continue",
      researchState: port,
      research: { type: "continue", researchId },
    });
    const waiting = port.commits.at(-1)!;
    expect(waiting).toMatchObject({
      phase: "awaiting-observation",
      pending: { kind: "observation" },
    });

    const resumed = reloaded(waiting);
    const stale = {
      type: "decision" as const,
      decision: {
        researchId,
        decisionId: waiting.pending!.decisionId,
        expectedRevision: waiting.revision - 1,
        payload: { action: "observe", text: "Tides followed the moon every day I watched." },
      },
    };
    await expect(
      answer(model, registry, { question: "Late", researchState: resumed, research: stale }),
    ).rejects.toThrow("no longer matches the research");
    const report = "Tides followed the moon every day I watched [source-1:revision-1].";
    await answer(model, registry, { question: report, researchState: resumed });

    const final = resumed.commits.at(-1)!;
    expect(final.phase).toBe("completed");
    const discovery = [...resumed.commits].reverse().find((state) => state.discovery)!.discovery!;
    expect(discovery.cycles.map((cycle) => cycle.decision)).toEqual(["continue", "finish"]);
    expect(discovery.observations).toMatchObject([
      {
        producer: "user",
        citationTokens: [],
        quote: report,
        limitations: ["reported, not independently checked"],
      },
    ]);
    expect(
      model.requests.filter((request) =>
        String(request.messages[0]?.content).startsWith("You find contradictions"),
      ),
    ).toHaveLength(1);
  });

  it("skips every observation across a reload and reaches a report without asking again", async () => {
    const model = new DiscoveryModel(["observation", "observation"], []);
    const registry = new ResearchRegistry();
    const port = stored("thorough");
    const researchId = port.commits[0]!.researchId;
    await answer(model, registry, {
      question: "Continue",
      researchState: port,
      research: { type: "continue", researchId },
    });
    const waiting = reloaded(port.commits.at(-1)!);
    const asked = waiting.commits[0]!;
    const skip = (expectedRevision: number) => ({
      type: "decision" as const,
      decision: {
        researchId,
        decisionId: asked.pending!.decisionId,
        expectedRevision,
        payload: { action: "skip-observations" },
      },
    });
    await expect(
      answer(model, registry, {
        question: "Skip",
        researchState: waiting,
        research: skip(asked.revision - 1),
      }),
    ).rejects.toThrow("no longer matches the research");
    expect(waiting.commits).toHaveLength(1);
    await answer(model, registry, {
      question: "Skip",
      researchState: waiting,
      research: skip(asked.revision),
    });

    const discovering = waiting.commits.filter((state) => state.phase === "discovering").at(-1)!;
    expect(reloaded(discovering).commits[0]!.discovery!.observationsSkipped).toBe(true);
    const final = waiting.commits.at(-1)!;
    expect(waiting.commits.slice(1).some((state) => state.phase === "awaiting-observation")).toBe(
      false,
    );
    expect(final.phase).toBe("completed");
    expect(final.discovery!.observationsSkipped).toBe(true);
    expect(final.discovery!.tests.every((test) => test.status === "unavailable")).toBe(true);
    expect(final.discovery!.notes.map((note) => note.outcome)).toContain(
      "Observation skipped by the user",
    );
    expect(String(model.requests.at(-1)!.messages.at(-1)!.content)).toContain(
      '<contested outcome="not checked against sources">',
    );
  });

  it("stops a turn while its supplied observation is assessed without recording it", async () => {
    const model = new DiscoveryModel(["observation"], ["supports"]);
    const port = stored("balanced");
    const researchId = port.commits[0]!.researchId;
    await answer(model, new ResearchRegistry(), {
      question: "Continue",
      researchState: port,
      research: { type: "continue", researchId },
    });
    const waiting = port.commits.at(-1)!;
    const resumed = reloaded(waiting);
    const stop = new AbortController();
    const assessing = (signal: AbortSignal) =>
      new Promise<never>((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason));
        stop.abort(new DOMException("Stopped", "AbortError"));
      });

    await expect(
      runResearch(resumed.commits[0]!, {
        port: resumed,
        runner: { path: "main", run: () => Promise.reject(new Error("unused")) },
        synthesis: {} as ReportSynthesisService,
        labels: ENGLISH_RESEARCH_LABELS,
        createDiscovery: (options) =>
          ({
            assessReport: () => assessing(options.signal),
          }) as unknown as ResearchDiscoveryService,
        observation: { testId: waiting.pending!.subjectId!, text: "It held." },
        signal: stop.signal,
        now: fixedNow,
        setTimer: () => () => undefined,
        createId: (prefix) => `${prefix}-1`,
        onState: () => undefined,
        onStatus: () => undefined,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(resumed.commits).toEqual([waiting]);
  });

  it("keeps a supplied observation as inconclusive when the time limit interrupts its assessment", async () => {
    const model = new DiscoveryModel(["observation"], ["supports"]);
    const port = stored("balanced");
    const researchId = port.commits[0]!.researchId;
    await answer(model, new ResearchRegistry(), {
      question: "Continue",
      researchState: port,
      research: { type: "continue", researchId },
    });
    const waiting = port.commits.at(-1)!;
    const resumed = reloaded(waiting);
    let timeLimit = (): void => undefined;
    const judge = {
      listModels: async () => ["model"],
      async *streamChat(request: { signal?: AbortSignal }) {
        timeLimit();
        throw request.signal!.reason;
      },
    };
    let id = 0;

    const { report } = await runResearch(resumed.commits[0]!, {
      port: resumed,
      runner: { path: "main", run: () => Promise.reject(new Error("unused")) },
      synthesis: {} as ReportSynthesisService,
      labels: ENGLISH_RESEARCH_LABELS,
      createDiscovery: (options) =>
        new ResearchDiscoveryService({
          chatModel: judge as unknown as DiscoveryModel,
          model: "model",
          chatOptions: {},
          createId: (prefix) => `${prefix}-${(id += 1)}`,
          now: () => fixedNow().toISOString(),
          ...options,
        }),
      observation: { testId: waiting.pending!.subjectId!, text: "It held." },
      now: fixedNow,
      setTimer: (_delayMs, callback) => {
        timeLimit = callback;
        return () => undefined;
      },
      createId: (prefix) => `${prefix}-${(id += 1)}`,
      onState: () => undefined,
      onStatus: () => undefined,
    });

    expect(report).not.toBeNull();
    const final = resumed.commits.at(-1)!;
    expect(final.phase).toBe("completed");
    for (const state of resumed.commits) {
      const section = JSON.parse(JSON.stringify(nextResearchSection(null, state)));
      expect(validateResearchSection(section).ok, state.phase).toBe(true);
    }
    expect(final.discovery!.observations).toMatchObject([
      { producer: "user", verdict: "inconclusive", quote: "It held." },
    ]);
  });

  it("stores a long sub-agent test finding within the discovery bounds so it reloads", async () => {
    const tokens = Array.from(
      { length: MAX_TEST_FINDING_TOKENS + 2 },
      (_, index) => `source-${index}:revision-1`,
    );
    const long = `${tokens.map((token) => `The moon pulls the oceans [${token}].`).join(" ")} ${"x".repeat(MAX_TEST_FINDING_CHARS)}`;
    const child: BranchRunner = {
      path: "sub-agent",
      run: async () => ({ text: long, citationTokens: tokens, partial: false }),
      runRef: () => ({ sessionId: "session-1", runId: "run-1", resultRevision: 1 }),
      usage: () => ({ modelRounds: 1, searches: 1, evidenceItems: 0 }),
    };
    const model = new DiscoveryModel(["literature"], ["supports"]);
    const start = {
      ...gatheringResearch(researchPlan([researchBranch(1)], "balanced")),
      sessionByBranch: { "branch-1": "session-1" },
    };
    const port = new MemoryResearchState();
    let id = 0;
    const evidence = (ids: readonly string[]) =>
      ids.map((token) =>
        retrieved(
          token,
          markdownSource("Notes/tides.md"),
          "The moon pulls the oceans and causes tides.",
        ),
      );
    await runResearch(start, {
      port,
      runner: { path: "main", run: () => Promise.reject(new Error("unused")) },
      subAgents: { attach: () => () => undefined, createRunner: () => child },
      synthesis: new ReportSynthesisService({ chatModel: model, model: "model", chatOptions: {} }),
      labels: ENGLISH_RESEARCH_LABELS,
      createDiscovery: (options) =>
        new ResearchDiscoveryService({
          chatModel: model,
          model: "model",
          chatOptions: {},
          createId: (prefix) => `${prefix}-${(id += 1)}`,
          now: () => "2026-01-01T01:00:00.000Z",
          ...options,
        }),
      resolveEvidence: evidence,
      now: () => new Date("2026-01-01T01:00:00.000Z"),
      setTimer: () => () => undefined,
      createId: (prefix) => `${prefix}-${(id += 1)}`,
      onState: () => undefined,
      onStatus: () => undefined,
    });

    const test = port.commits.at(-1)!.discovery!.executions[0]!;
    expect(test).toMatchObject({ path: "sub-agent", runRef: { sessionId: "session-1" } });
    expect(test.finding!.text.length).toBe(MAX_TEST_FINDING_CHARS);
    expect(test.finding!.citationTokens).toEqual(tokens.slice(0, MAX_TEST_FINDING_TOKENS));
    for (const state of port.commits.slice(0, -1)) {
      expect(
        validateResearchSection(
          JSON.parse(JSON.stringify({ schema: 1, active: state, history: [] })),
        ).ok,
        state.phase,
      ).toBe(true);
    }
  });

  it("records a supplied observation on a stale plan and asks about the plan before scheduling", async () => {
    const model = new DiscoveryModel(["observation"], ["supports"]);
    const registry = new ResearchRegistry();
    const port = stored("balanced");
    const researchId = port.commits[0]!.researchId;
    await answer(model, registry, {
      question: "Continue",
      researchState: port,
      research: { type: "continue", researchId },
    });
    const resumed = reloaded(port.commits.at(-1)!);
    const rounds = new BranchModelRounds();
    const later = () => new Date(fixedNow().getTime() + 30 * 24 * 3_600_000);
    await answer(model, registry, { question: "It held.", researchState: resumed }, rounds, later);

    const final = resumed.commits.at(-1)!;
    expect(final.pending).toMatchObject({ kind: "stale-plan" });
    expect(final.discovery!.observations).toMatchObject([{ producer: "user", quote: "It held." }]);
    expect(rounds.tasks).toEqual([]);

    const replan = {
      type: "decision" as const,
      decision: {
        researchId,
        decisionId: final.pending!.decisionId,
        expectedRevision: final.revision,
        payload: { action: "replan" },
      },
    };
    await answer(
      model,
      registry,
      { question: "Replan", researchState: resumed, research: replan },
      rounds,
      later,
    );
    const review = reloaded(resumed.commits.at(-1)!);
    const pending = review.commits.at(-1)!;
    expect(pending).toMatchObject({ phase: "awaiting-approval", discovery: null });
    const approve = {
      type: "decision" as const,
      decision: {
        researchId,
        decisionId: pending.pending!.decisionId,
        expectedRevision: pending.revision,
        payload: { action: "approve" },
      },
    };
    await answer(
      model,
      registry,
      { question: "Approve", researchState: review, research: approve },
      rounds,
      later,
    );
    expect(review.commits.at(-1)!.phase).toBe("completed");
  });
});
