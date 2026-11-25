import {
  addTally,
  claimTally,
  currentStageNumber,
  emptyBudgetState,
  researchStages,
  writingSections,
  writingStep,
  type ResearchActivity,
  type ResearchPhase,
  type ResearchState,
} from "@core/research/deepResearch";
import { ResearchActivityReporter } from "@application/use-cases/research/deep-research/researchActivityReporter";
import { gatheringResearch, researchBranch, researchPlan } from "../support/deepResearch";

const assessment = (verdict: "supported" | "conflicted" | "unsupported" | "unresolved") => ({
  claimId: verdict,
  verdict,
  quote: null,
  contradictingTokens: [],
  independenceGroups: [],
});

describe("deep research activity", () => {
  it("reads the written headings of a streamed report and lists the outline left to write", () => {
    const step = writingStep("# Summary\nTides follow the moon.\n\n## 2. Risks ##\nSome");
    expect(step).toEqual({ kind: "writing", words: 11, headings: ["Summary", "2. Risks"] });
    expect(writingSections(["Summary", "Risks", "Advice"], step.headings)).toEqual([
      { title: "Summary", status: "done" },
      { title: "2. Risks", status: "current" },
      { title: "Advice", status: "pending" },
    ]);
  });

  it("tallies verdicts against the claims and adds an earlier round", () => {
    const tally = claimTally(
      [assessment("supported"), assessment("conflicted"), assessment("unsupported")],
      5,
    );
    expect(tally).toEqual({ supported: 1, conflicted: 1, unverified: 1, total: 5 });
    expect(addTally(tally, claimTally([assessment("unresolved")], 0))).toEqual({
      supported: 1,
      conflicted: 1,
      unverified: 2,
      total: 6,
    });
  });

  it("derives the stages after the gather wave from the phase and the follow-ups", () => {
    const base = gatheringResearch(researchPlan([researchBranch(1)], "balanced"));
    const followUp = (state: "running" | "completed") => ({
      ...base.executions[0]!,
      workId: "follow-up",
      state,
    });
    const at = (
      phase: ResearchPhase,
      followUps: ReturnType<typeof followUp>[] = [],
      preset: "balanced" | "conservative" = "balanced",
    ): string => {
      const plan = researchPlan([researchBranch(1)], preset);
      const state: ResearchState = {
        ...base,
        plan,
        phase,
        verification: {
          claims: [],
          assessments: [],
          coverage: [],
          verifiedWorks: [],
          followUps,
          followUpsUsed: followUps.length,
        },
      };
      const rows = researchStages(state, plan, null);
      return `${currentStageNumber(rows)}/${rows.map((row) => `${row.stage}:${row.status}`).join(" ")}`;
    };
    expect([
      at("discovering"),
      at("verifying", [followUp("running")]),
      at("verifying", [followUp("completed")]),
      at("synthesizing"),
      at("verifying", [], "conservative"),
    ]).toEqual([
      "1/hypotheses:running verification:pending follow-ups:pending writing:pending",
      "3/hypotheses:done verification:done follow-ups:running writing:pending",
      "2/hypotheses:done verification:running follow-ups:done writing:pending",
      "4/hypotheses:done verification:done follow-ups:skipped writing:running",
      "1/verification:running follow-ups:pending writing:pending",
    ]);
  });

  it("times each stage of a turn and keeps verification open while its follow-ups run", () => {
    let now = 0;
    const emitted: ResearchActivity[] = [];
    const reporter = new ResearchActivityReporter(
      "research-1",
      () => now,
      () => emptyBudgetState(),
      (activity) => emitted.push(activity),
    );
    reporter.step("hypotheses", { kind: "proposing", cycle: 1 });
    now = 10;
    reporter.step("verification", { kind: "extracting", batch: 1, batches: 1 });
    now = 20;
    reporter.step("follow-ups", { kind: "following-up", count: 1 });
    now = 30;
    reporter.verification(null)({ kind: "extracting", batch: 1, batches: 1 });
    expect(emitted.map((activity) => activity.stages)).toEqual([
      { hypotheses: { startedAt: 0 } },
      { hypotheses: { startedAt: 0, endedAt: 10 }, verification: { startedAt: 10 } },
      {
        hypotheses: { startedAt: 0, endedAt: 10 },
        verification: { startedAt: 10 },
        "follow-ups": { startedAt: 20 },
      },
      {
        hypotheses: { startedAt: 0, endedAt: 10 },
        verification: { startedAt: 10 },
        "follow-ups": { startedAt: 20, endedAt: 30 },
      },
    ]);
  });

  it("counts a verification round on top of earlier claims and reports writing in steps", () => {
    const emitted: ResearchActivity[] = [];
    const reporter = new ResearchActivityReporter(
      "research-1",
      () => 0,
      () => emptyBudgetState(),
      (activity) => emitted.push(activity),
    );
    const earlier = {
      claims: [{ claimId: "a" }, { claimId: "b" }],
      assessments: [assessment("supported")],
    } as unknown as Parameters<ResearchActivityReporter["verification"]>[0];
    reporter.verification(earlier)({
      kind: "checking",
      batch: 1,
      batches: 1,
      from: 1,
      to: 1,
      tally: { supported: 0, conflicted: 1, unverified: 0, total: 1 },
    });
    const words = (count: number): string => Array.from({ length: count }, () => "w").join(" ");
    reporter.writing(words(1));
    reporter.writing(words(25));
    reporter.writing(words(26));
    reporter.writing(`${words(26)}\n## Risks`);
    expect(emitted.map((activity) => activity.step)).toEqual([
      {
        kind: "checking",
        batch: 1,
        batches: 1,
        from: 3,
        to: 3,
        tally: { supported: 1, conflicted: 1, unverified: 0, total: 3 },
      },
      { kind: "writing", words: 1, headings: [] },
      { kind: "writing", words: 26, headings: [] },
      { kind: "writing", words: 28, headings: ["Risks"] },
    ]);
  });
});
