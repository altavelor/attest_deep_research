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

function answer(
  model: DiscoveryModel,
  registry: ResearchRegistry,
  request: Omit<ResearchRequest, "mode">,
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
      modelRound: new BranchModelRounds(),
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
    await answer(model, new ResearchRegistry(), {
      question: "Continue",
      researchState: port,
      research: { type: "continue", researchId },
    });

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
    const rounds = port.commits.map((state) => state.budget?.consumed.modelRounds ?? 0);
    expect(rounds.every((value, index) => index === 0 || value >= rounds[index - 1]!)).toBe(true);
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
});
