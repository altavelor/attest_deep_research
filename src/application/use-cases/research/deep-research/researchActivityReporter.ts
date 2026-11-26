import {
  writingStep,
  type ResearchActivity,
  type ResearchBudgetState,
  type ResearchStage,
  type ResearchStageTime,
  type ResearchStep,
} from "@core/research/deepResearch";

const WRITING_WORDS_STEP = 25;

/**
 * Reports what a research turn does after its gather wave without committing the state: each
 * step names its stage, every stage keeps its start and end time within the turn, and the spent
 * budget goes along. Entering a stage ends the open ones. Streamed report text is reported when a heading appears or the text, or
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
      this.stages[name] = { ...time, endedAt: at };
    }
    const own = this.stages[stage];
    if (!own) this.stages[stage] = { startedAt: at };
    else if (own.endedAt !== undefined) this.stages[stage] = { startedAt: own.startedAt };
  }
}
