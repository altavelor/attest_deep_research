import type { ResearchStreamEvent } from "@application/contracts/research";
import { collectAsync } from "../support/async";
import {
  BranchModelRounds,
  MemoryResearchState,
  PlanAndReportModel,
  ResearchRegistry,
  deepResearchService,
} from "../support/deepResearch";

function completed(events: readonly ResearchStreamEvent[]) {
  const last = events.at(-1);
  return last?.type === "complete" ? last.answer : null;
}

describe("deep research turn diagnostics", () => {
  it("attaches the deep research block to planning and approved turns when diagnostics are requested", async () => {
    const model = new PlanAndReportModel();
    const rounds = new BranchModelRounds();
    const registry = new ResearchRegistry();
    let fire: () => void = () => undefined;
    const service = deepResearchService(model, {
      modelRound: rounds,
      researchTimer: (_delay, callback) => {
        fire = callback;
        return () => undefined;
      },
    });
    const port = new MemoryResearchState();
    const turn = (question: string, extra: object) =>
      collectAsync(
        service.answer({
          question,
          mode: "deep-research",
          researchState: port,
          finalizeAnswer: registry.finalizeAnswer,
          resolveEvidence: registry.resolveEvidence,
          ...extra,
        }),
      );

    const planning = await turn("Tides?", {});
    expect(completed(planning)?.contextDiagnostics).toBeUndefined();
    port.commits.length = 0;
    const replanned = await turn("Tides?", { includeContextDiagnostics: true });
    const plan = completed(replanned)!.contextDiagnostics!;
    expect(plan.executionStrategy).toBe("deep-research");
    expect(plan.deepResearch).toMatchObject({
      turnKind: "start",
      phaseBefore: null,
      phaseAfter: "awaiting-approval",
      plan: { revision: 1, branches: [{ title: "Background", enabled: true }, {}, {}] },
    });

    const pending = port.commits.at(-1)!;
    rounds.hang.add("Collect details");
    rounds.onHang = () => fire();
    const approved = await turn("Approve", {
      includeContextDiagnostics: true,
      research: {
        type: "decision",
        decision: {
          researchId: pending.researchId,
          decisionId: pending.pending!.decisionId,
          expectedRevision: pending.revision,
          payload: { action: "approve" },
        },
      },
    });
    const run = completed(approved)!.contextDiagnostics!.deepResearch!;
    expect(run).toMatchObject({
      turnKind: "decision",
      phaseBefore: "awaiting-approval",
      budget: { closedReason: "time", closedDimension: null, openAllocations: 0 },
    });
    const gathered = run.works.filter((work) => work.kind === "gather");
    expect(gathered.map((work) => work.state)).toEqual(["completed", "pending", "pending"]);
    expect(gathered[0]).toMatchObject({ runner: "main", runs: [{ attempt: 1, path: "main" }] });
    expect(gathered[0]!.findingChars).toBeGreaterThan(0);
    expect(gathered[0]!.runs[0]!.rounds).not.toBeNull();
  });
});
