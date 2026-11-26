import {
  currentStageNumber,
  emptyBudgetState,
  researchStages,
  writingSections,
  writingStep,
  type ResearchActivity,
  type ResearchPhase,
} from "@core/research/deepResearch";
import { ResearchActivityReporter } from "@application/use-cases/research/deep-research/researchActivityReporter";
import { gatheringResearch, researchBranch, researchPlan } from "../support/deepResearch";

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

  it("derives the stages after the gather wave from the phase", () => {
    const base = gatheringResearch(researchPlan([researchBranch(1)], "balanced"));
    const at = (phase: ResearchPhase, preset: "balanced" | "conservative" = "balanced"): string => {
      const plan = researchPlan([researchBranch(1)], preset);
      const rows = researchStages({ ...base, plan, phase }, plan);
      return `${currentStageNumber(rows)}/${rows.map((row) => `${row.stage}:${row.status}`).join(" ")}`;
    };
    expect([
      at("discovering"),
      at("verifying"),
      at("synthesizing"),
      at("synthesizing", "conservative"),
    ]).toEqual([
      "1/hypotheses:running writing:pending",
      "2/hypotheses:done writing:pending",
      "2/hypotheses:done writing:running",
      "1/writing:running",
    ]);
  });

  it("times each stage of a turn and ends the hypothesis stage when writing starts", () => {
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
    reporter.writing("Summary");
    expect(emitted.map((activity) => activity.stages)).toEqual([
      { hypotheses: { startedAt: 0 } },
      { hypotheses: { startedAt: 0, endedAt: 10 }, writing: { startedAt: 10 } },
    ]);
  });

  it("reports writing in steps of words and of reasoning", () => {
    const emitted: ResearchActivity[] = [];
    const reporter = new ResearchActivityReporter(
      "research-1",
      () => 0,
      () => emptyBudgetState(),
      (activity) => emitted.push(activity),
    );
    const words = (count: number): string => Array.from({ length: count }, () => "w").join(" ");
    reporter.writing(words(1));
    reporter.writing(words(25));
    reporter.writing(words(26));
    reporter.writing(`${words(26)}\n## Risks`);
    reporter.writing(`${words(26)}\n## Risks`, 24);
    reporter.writing(`${words(26)}\n## Risks`, 25);
    expect(emitted.map((activity) => activity.step)).toEqual([
      { kind: "writing", words: 1, headings: [] },
      { kind: "writing", words: 26, headings: [] },
      { kind: "writing", words: 28, headings: ["Risks"] },
      { kind: "writing", words: 28, headings: ["Risks"], thinking: 25 },
    ]);
  });
});
