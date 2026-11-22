import type { ResearchRequest } from "@application/contracts/research";
import { validateResearchSection, type ResearchState } from "@core/research/deepResearch";
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
) {
  return collectAsync(
    deepResearchService(model, true, {
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
    await answer(
      model,
      new ResearchRegistry(),
      { question: "Continue", researchState: port, research: { type: "continue", researchId } },
      rounds,
    );

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
    expect(final.budget!.attemptsByBranch).toEqual({ "branch-1": 3 });
    expect(final.report!.markdown).toContain("(supported by literature) The moon causes tides");
    const verification = [...port.commits].reverse().find((state) => state.verification)!;
    expect(
      verification.verification!.claims.filter((claim) => claim.kind === "hypothesis"),
    ).toHaveLength(1);
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
    await answer(model, registry, {
      question: "Tides followed the moon every day I watched.",
      researchState: resumed,
    });

    const final = resumed.commits.at(-1)!;
    expect(final.phase).toBe("completed");
    const discovery = [...resumed.commits].reverse().find((state) => state.discovery)!.discovery!;
    expect(discovery.cycles.map((cycle) => cycle.decision)).toEqual(["continue", "finish"]);
    expect(discovery.observations).toMatchObject([
      { producer: "user", limitations: ["reported, not independently checked"] },
    ]);
    expect(
      model.requests.filter((request) =>
        String(request.messages[0]?.content).startsWith("You turn research findings"),
      ),
    ).toHaveLength(1);
  });

  it("stores a long sub-agent test finding within the discovery bounds so it reloads", async () => {
    const tokens = Array.from({ length: 6 }, (_, index) => `source-${index}:revision-1`);
    const long = `${tokens.map((token) => `The moon pulls the oceans [${token}].`).join(" ")} ${"x".repeat(2000)}`;
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
    expect(test.finding!.text.length).toBeLessThanOrEqual(600);
    expect(test.finding!.citationTokens).toEqual(tokens.slice(0, 4));
    for (const state of port.commits.slice(0, -1)) {
      expect(
        validateResearchSection(
          JSON.parse(JSON.stringify({ schema: 1, active: state, history: [] })),
        ).ok,
        state.phase,
      ).toBe(true);
    }
  });
});
