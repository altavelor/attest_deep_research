import type { ResearchLabelKey, ResearchLabels } from "@core/research/deepResearch";

export const RESEARCH_ANSWER_PREFIX = "deepResearch.answer.";

export type ResearchAnswerMessages = {
  readonly [K in ResearchLabelKey as `deepResearch.answer.${K}`]: string;
};

/** Turns the answer labels of one language into catalogue entries under their message keys. */
export function researchAnswerMessages(labels: ResearchLabels): ResearchAnswerMessages {
  return Object.fromEntries(
    Object.entries(labels).map(([key, value]) => [`${RESEARCH_ANSWER_PREFIX}${key}`, value]),
  ) as unknown as ResearchAnswerMessages;
}
