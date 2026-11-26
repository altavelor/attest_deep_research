import type { ResearchRequest, ResearchStreamEvent } from "@application/contracts/research";
import { validateResearchSection, type ResearchState } from "@core/research/deepResearch";
import { MAX_REPORT_OUTPUT_TOKENS } from "@application/use-cases/research/deep-research/ReportSynthesisService";
import { collectAsync } from "../support/async";
import {
  BranchModelRounds,
  MemoryResearchState,
  PlanAndReportModel,
  ResearchRegistry,
  deepResearchService,
} from "../support/deepResearch";
import { markdownSource, retrieved } from "../support/factories";
import { FakeRetriever } from "../support/researchFakes";

const retriever = () =>
  new FakeRetriever({
    chunks: [
      retrieved(
        "chunk-tides-1",
        markdownSource("Notes/tides.md"),
        "The moon pulls the oceans and causes tides twice a day.",
      ),
    ],
    citations: [],
    usedFallback: false,
  });

interface Harness {
  model: PlanAndReportModel;
  rounds: BranchModelRounds;
  registry: ResearchRegistry;
  timer?: (delayMs: number, callback: () => void) => () => void;
}

function answer(harness: Harness, request: Omit<ResearchRequest, "mode">) {
  return collectAsync(
    deepResearchService(harness.model, {
      retriever: retriever(),
      modelRound: harness.rounds,
      ...(harness.timer ? { researchTimer: harness.timer } : {}),
    }).answer({
      ...request,
      mode: "deep-research",
      finalizeAnswer: harness.registry.finalizeAnswer,
      resolveEvidence: harness.registry.resolveEvidence,
    }),
  );
}

async function approvedResearch(harness: Harness) {
  const port = new MemoryResearchState();
  await answer(harness, { question: "Tides?", researchState: port });
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

function harness(): Harness {
  return {
    model: new PlanAndReportModel(),
    rounds: new BranchModelRounds(),
    registry: new ResearchRegistry(),
  };
}

function reloaded(state: ResearchState): MemoryResearchState {
  const stored = validateResearchSection(
    JSON.parse(JSON.stringify({ schema: 1, active: state, history: [] })),
  );
  const port = new MemoryResearchState();
  if (stored.ok) port.commits.push(stored.value.active!);
  return port;
}

function completeAnswer(events: readonly ResearchStreamEvent[]) {
  const last = events.at(-1);
  return last?.type === "complete" ? last.answer : null;
}

describe("deep research run", () => {
  it("runs three approved branches one after another and ends in a cited report", async () => {
    const run = harness();
    const { port, decision } = await approvedResearch(run);
    let commitsAtSynthesis = -1;
    run.model.onReport = () => (commitsAtSynthesis = port.commits.length);
    const events = await answer(run, {
      question: "Approve",
      researchState: port,
      research: decision,
      includeContextDiagnostics: true,
    });

    const statuses = events.flatMap((event) => (event.type === "status" ? [event.message] : []));
    expect(statuses).toEqual([
      "Researching: Background",
      "Researching: Details",
      "Researching: Context",
      "Testing hypotheses…",
      "Writing the research report…",
    ]);
    const lastSettle = port.commits.findIndex(
      (state) =>
        state.executions.length > 0 &&
        state.executions.every((execution) => execution.state === "completed"),
    );
    expect(commitsAtSynthesis).toBeGreaterThan(lastSettle + 1);
    const final = port.commits.at(-1)!;
    expect(final.report).toMatchObject({
      quality: "complete",
      completedBranches: ["branch-1", "branch-2", "branch-3"],
      scale: { objectives: final.plan!.objectives.length },
      stats: {
        sourcesFound: 1,
        documentsOpened: 0,
        sourcesCited: 1,
        removedCitations: 1,
        uncitedBranches: [],
      },
    });
    const report = completeAnswer(events)!;
    expect(report.answer).toBe(final.report!.markdown);
    expect(report.answer).not.toContain("source-9:revision-9");
    expect(report.answer).toContain("1 citation(s) without a source in the findings were removed.");
    const cited = /causes tides \[(\S+)\]/u.exec(report.answer)?.[1];
    expect(run.registry.resolveEvidence([cited!])).toHaveLength(1);
    expect(report.citations.map((citation) => citation.id)).toEqual([cited]);
    expect(run.model.requests.at(-1)!.maxTokens).toBe(MAX_REPORT_OUTPUT_TOKENS);
    expect(String(run.model.requests.at(-1)!.messages[0]!.content)).toContain("Current date:");
    expect(report.contextDiagnostics?.deepResearch?.tokensByStage).toContainEqual({
      stage: "writing",
      inputTokens: 40,
      outputTokens: 9,
    });
    expect(report.evidence?.map((chunk) => chunk.id)).toEqual([cited]);
  });

  it("continues a stopped research without rerunning completed branches, keeps its budget and records a cut summary", async () => {
    const run = harness();
    const { port, decision } = await approvedResearch(run);
    run.rounds.hang.add("Collect details");
    const stop = new AbortController();
    run.rounds.onHang = () => stop.abort();
    await expect(
      answer(run, {
        question: "Approve",
        researchState: port,
        research: decision,
        signal: stop.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    const paused = port.commits.at(-1)!;
    expect(paused.executions.map((execution) => execution.state)).toEqual([
      "completed",
      "running",
      "pending",
    ]);

    run.rounds.hang.clear();
    run.rounds.tasks.length = 0;
    const [first, ...rest] = paused.executions;
    const tampered = {
      ...first!,
      finding: {
        ...first!.finding!,
        text: `${first!.finding!.text} Forged [source-7:revision-7].`,
        citationTokens: [...first!.finding!.citationTokens, "source-7:revision-7"],
      },
    };
    const resumed = reloaded({ ...paused, executions: [tampered, ...rest] });
    run.model.cutReport = true;
    const events = await answer(run, {
      question: "Continue",
      researchState: resumed,
      research: { type: "continue", researchId: paused.researchId },
    });

    expect(run.rounds.tasks.map((task) => task.includes("Collect background"))).not.toContain(true);
    const final = resumed.commits.at(-1)!;
    expect(final.phase).toBe("completed");
    expect(final.budget!.consumed.branchAttempts).toBe(4);
    expect(final.budget!.consumed.modelRounds).toBeGreaterThanOrEqual(
      paused.budget!.consumed.modelRounds + 12,
    );
    const synthesis = String(run.model.requests.at(-1)?.messages.at(-1)?.content);
    expect(synthesis).toContain(first!.finding!.citationTokens[0]);
    expect(synthesis).not.toContain("source-7:revision-7");
    expect(completeAnswer(events)?.answer).toContain("Findings are listed per branch");
    expect(final.report!.summaryFailure).toBe(
      "The output limit was reached after 4 words of reasoning, before the report.",
    );
  });

  it("closes the budget at the time limit, aborts the running branch and reports without a model", async () => {
    const run = harness();
    const { port, decision } = await approvedResearch(run);
    let fire: () => void = () => undefined;
    let cancelled = false;
    run.timer = (_delay, callback) => {
      fire = callback;
      return () => (cancelled = true);
    };
    run.rounds.hang.add("Collect details");
    run.rounds.onHang = () => fire();
    const events = await answer(run, {
      question: "Approve",
      researchState: port,
      research: decision,
    });

    const synthesizing = port.commits.findIndex((state) => state.phase === "synthesizing");
    expect(port.commits[synthesizing - 1]).toMatchObject({
      executions: [{ state: "completed" }, { state: "pending" }, { state: "pending" }],
      budget: { openAllocations: [], closed: { reason: "time", dimension: null } },
    });
    expect(cancelled).toBe(true);
    expect(port.commits.at(-1)!.report).toMatchObject({
      quality: "partial",
      missingBranches: [{ branchId: "branch-2" }, { branchId: "branch-3" }],
    });
    expect(completeAnswer(events)?.answer).toContain(
      "The active execution time limit was reached.",
    );
    expect(run.model.requests).toHaveLength(2);
  });
});
