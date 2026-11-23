import { DEFAULT_LOCALE, matchHostLanguage } from "@core/i18n";
import { RESEARCH_LABEL_KEYS, type ResearchLabels } from "@core/research/deepResearch";
import type { ResearchLabelsPort } from "@application/ports";
import { createTranslator } from "./Translator";
import { RESEARCH_ANSWER_PREFIX } from "./researchAnswerMessages";

/**
 * Serves the Deep Research answer labels from the locale catalogue of the research language. A
 * language outside the supported locales gets the English labels.
 */
export function createResearchLabelCatalogue(): ResearchLabelsPort {
  return {
    labelsFor(language: string): ResearchLabels {
      const { translate } = createTranslator(matchHostLanguage(language) ?? DEFAULT_LOCALE);
      return Object.fromEntries(
        RESEARCH_LABEL_KEYS.map((key) => [key, translate(`${RESEARCH_ANSWER_PREFIX}${key}`)]),
      ) as unknown as ResearchLabels;
    },
  };
}
