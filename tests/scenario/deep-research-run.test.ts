import type { ResearchStreamEvent } from "@application/contracts/research";
import { validateResearchSection, type ResearchState } from "@core/research/deepResearch";
import { collectAsync } from "../support/async";
import {
  BranchModelRounds,
  MemoryResearchState,
  PlanAndReportModel,
  deepResearchService,
} from "../support/deepResearch";
import { markdownSource, retrieved } from "../support/factories";
import { FakeRetriever } from "../support/researchFakes";

const retriever = () =>
  new FakeRetriever({
    chunks: [
      retrieved(
        "chunk-1",
        markdownSource("Notes/tides.md"),
        "The moon pulls the oceans and causes tides twice a day.",
      ),
    ],
    citations: [],
    usedFallback: false,
  });

function service(
  model: PlanAndReportModel,
  rounds: BranchModelRounds,
  timer?: (delayMs: number, callback: () => void) => () => void,
) {
  return deepResearchService(model, true, {
    retriever: retriever(),
    modelRound: rounds,
    ...(timer ? { researchTimer: timer } : {}),
  });
}

async function approvedResearch(model: PlanAndReportModel, rounds: BranchModelRounds) {
  const port = new MemoryResearchState();
  await collectAsync(
    service(model, rounds).answer({
      question: "Tides?",
      mode: "deep-research",
      researchState: port,
    }),
  );
  const pending = port.commits.at(-1)!;
  const decision = {
    type: "decision" as const,
    decision: {
      researchId: pending.researchId,
      decisionId: pending.pending!.decisionId,
      expectedRevision: pending.revision,
      payload: { action: "approve" },
    },
  };
  return { port, decision };
}

function reloaded(state: ResearchState): MemoryResearchState {
  const stored = validateResearchSection(
    JSON.parse(JSON.stringify({ schema: 1, active: state, history: [] })),
  );
  const port = new MemoryResearchState();
  if (stored.ok) port.commits.push(stored.value.active!);
  return port;
}

describe("deep research run", () => {
  it("runs three approved branches one after another and ends in a cited report", async () => {
    const model = new PlanAndReportModel();
    const rounds = new BranchModelRounds();
    const { port, decision } = await approvedResearch(model, rounds);
    const events = await collectAsync(
      service(model, rounds).answer({
        question: "Approve",
        mode: "deep-research",
        researchState: port,
        research: decision,
      }),
    );

    const statuses = events.flatMap((event: ResearchStreamEvent) =>
      event.type === "status" ? [event.message] : [],
    );
    expect(statuses).toEqual([
      "Researching: Background",
      "Researching: Details",
      "Researching: Context",
      "Writing the research report…",
    ]);
    const lastSettle = port.commits.findIndex((state) =>
      state.executions.every((execution) => execution.state === "completed"),
    );
    const synthesizing = port.commits.findIndex((state) => state.phase === "synthesizing");
    expect(lastSettle).toBeLessThan(synthesizing);
    const final = port.commits.at(-1)!;
    expect(final.report).toMatchObject({
      quality: "complete",
      completedBranches: ["branch-1", "branch-2", "branch-3"],
    });
    const complete = events.at(-1);
    expect(complete?.type === "complete" && complete.answer.answer).toMatch(
      /causes tides \[\S+\]/u,
    );
    expect(model.requests).toHaveLength(2);
  });

  it("continues a stopped research without rerunning completed branches and keeps its budget", async () => {
    const model = new PlanAndReportModel();
    const rounds = new BranchModelRounds();
    const { port, decision } = await approvedResearch(model, rounds);
    rounds.hang.add("Collect details");
    const stop = new AbortController();
    rounds.onHang = () => stop.abort();
    await expect(
      collectAsync(
        service(model, rounds).answer({
          question: "Approve",
          mode: "deep-research",
          researchState: port,
          research: decision,
          signal: stop.signal,
        }),
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    const paused = port.commits.at(-1)!;
    expect(paused.executions.map((execution) => execution.state)).toEqual([
      "completed",
      "running",
      "pending",
    ]);

    rounds.hang.clear();
    rounds.tasks.length = 0;
    const resumed = reloaded(paused);
    await collectAsync(
      service(model, rounds).answer({
        question: "Continue",
        mode: "deep-research",
        researchState: resumed,
        research: { type: "continue", researchId: paused.researchId },
      }),
    );

    expect(rounds.tasks.map((task) => task.includes("Collect background"))).not.toContain(true);
    const final = resumed.commits.at(-1)!;
    expect(final.phase).toBe("completed");
    expect(final.budget!.consumed.branchAttempts).toBe(4);
    expect(final.budget!.consumed.modelRounds).toBeGreaterThanOrEqual(
      paused.budget!.consumed.modelRounds + 12,
    );
  });

  it("closes the budget at the time limit, aborts the running branch and reports without a model", async () => {
    const model = new PlanAndReportModel();
    const rounds = new BranchModelRounds();
    const { port, decision } = await approvedResearch(model, rounds);
    let fire: () => void = () => undefined;
    rounds.hang.add("Collect details");
    rounds.onHang = () => fire();
    const events = await collectAsync(
      service(model, rounds, (_delay, callback) => {
        fire = callback;
        return () => undefined;
      }).answer({
        question: "Approve",
        mode: "deep-research",
        researchState: port,
        research: decision,
      }),
    );

    const final = port.commits.at(-1)!;
    expect(final.budget!.closed).toEqual({ reason: "time", dimension: null });
    expect(final.report).toMatchObject({
      quality: "partial",
      missingBranches: [{ branchId: "branch-2" }, { branchId: "branch-3" }],
    });
    const complete = events.at(-1);
    expect(complete?.type === "complete" && complete.answer.answer).toContain(
      "The active execution time limit was reached.",
    );
    expect(model.requests).toHaveLength(1);
  });
});
