import {
  addTally,
  claimTally,
  writingStep,
  type ResearchActivity,
  type ResearchBudgetState,
  type ResearchStage,
  type ResearchStageTime,
  type ResearchStep,
  type ResearchVerification,
} from "@core/research/deepResearch";

const WRITING_WORDS_STEP = 25;

/**
 * Reports what a research turn does after its gather wave without committing the state: each
 * step names its stage, every stage keeps its start and end time within the turn, and the spent
 * budget goes along. Entering a stage ends the open ones, except the verification that runs the
 * follow-ups it requested. Streamed report text is reported when a heading appears or the text, or
 * the reasoning before it, grows by a few words.
 */
export class ResearchActivityReporter {
  private readonly stages: Partial<Record<ResearchStage, ResearchStageTime>> = {};
  private lastWriting: Extract<ResearchStep, { kind: "writing" }> | null = null;

  constructor(
    private readonly researchId: string,
    private readonly now: () => number,
    private readonly budget: () => ResearchBudgetState,
    private readonly emit: (activity: ResearchActivity) => void,
  ) {}

  step(stage: ResearchStage, step: ResearchStep): void {
    this.enter(stage);
    const budget = this.budget();
    this.emit({
      researchId: this.researchId,
      at: this.now(),
      stage,
      stages: { ...this.stages },
      step,
      budget: {
        activeMs: budget.activeMs,
        modelRounds: budget.consumed.modelRounds,
        branchAttempts: budget.consumed.branchAttempts,
      },
    });
  }

  /** Returns the progress callback of one verification round, counted on top of earlier rounds. */
  verification(earlier: ResearchVerification | null): (step: ResearchStep) => void {
    const claims = earlier?.claims.length ?? 0;
    const tally = claimTally(earlier?.assessments ?? [], claims);
    return (step) =>
      this.step(
        "verification",
        step.kind === "checking"
          ? {
              ...step,
              from: step.from + claims,
              to: step.to + claims,
              tally: addTally(tally, step.tally),
            }
          : step,
      );
  }

  writing(markdown: string, thinking = 0): void {
    const step = writingStep(markdown, thinking);
    const last = this.lastWriting;
    if (
      last &&
      last.headings.length === step.headings.length &&
      step.words - last.words < WRITING_WORDS_STEP &&
      thinking - (last.thinking ?? 0) < WRITING_WORDS_STEP
    ) {
      return;
    }
    this.lastWriting = step;
    this.step("writing", step);
  }

  private enter(stage: ResearchStage): void {
    const at = this.now();
    for (const [name, time] of Object.entries(this.stages) as [
      ResearchStage,
      ResearchStageTime,
    ][]) {
      if (name === stage || time.endedAt !== undefined) continue;
      if (name === "verification" && stage === "follow-ups") continue;
      this.stages[name] = { ...time, endedAt: at };
    }
    const own = this.stages[stage];
    if (!own) this.stages[stage] = { startedAt: at };
    else if (own.endedAt !== undefined) this.stages[stage] = { startedAt: own.startedAt };
  }
}
