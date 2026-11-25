import type { ResearchLabels } from "@core/research/deepResearch";

/**
 * Supplies the fixed answer text of a Deep Research in the research language. A language without
 * its own catalogue gets the English labels.
 */
export interface ResearchLabelsPort {
  labelsFor(language: string): ResearchLabels;
}
