import type { Translate } from "@adapters/i18n";
import type { ResearchStep } from "@core/research/deepResearch";

/** Describes what a research does right now, in the language of the interface. */
export function researchStepText(step: ResearchStep, t: Translate): string {
  switch (step.kind) {
    case "proposing":
      return t("chat.deepResearch.progress.step.proposing", { cycle: step.cycle });
    case "testing":
      return t("chat.deepResearch.progress.step.testing", { cycle: step.cycle });
    case "judging":
      return t("chat.deepResearch.progress.step.judging", {
        current: step.done,
        total: step.total,
        cycle: step.cycle,
      });
    case "extracting":
      return t("chat.deepResearch.progress.step.extracting", {
        batch: step.batch,
        batches: step.batches,
      });
    case "checking":
      return t("chat.deepResearch.progress.step.checking", {
        from: step.from,
        to: step.to,
        batch: step.batch,
        batches: step.batches,
      });
    case "following-up":
      return t("chat.deepResearch.progress.step.followingUp", { count: step.count });
    case "writing": {
      const section = step.headings.at(-1);
      return section === undefined
        ? t("chat.deepResearch.progress.step.writing", { words: step.words })
        : t("chat.deepResearch.progress.step.writingSection", { section, words: step.words });
    }
  }
}
