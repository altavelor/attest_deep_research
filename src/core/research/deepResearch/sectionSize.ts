import { MAX_RESEARCH_SECTION_BYTES } from "./limits";
import type { DeepResearchSection } from "./types";

/**
 * Fits a research section into the size cap by dropping its oldest history entries. Returns null
 * when the section is still over the cap without any history.
 */
export function fitResearchSection(section: DeepResearchSection): DeepResearchSection | null {
  let history = section.history;
  for (;;) {
    const candidate = { ...section, history };
    if (sectionBytes(candidate) <= MAX_RESEARCH_SECTION_BYTES) return candidate;
    if (history.length === 0) return null;
    history = history.slice(0, -1);
  }
}

function sectionBytes(section: DeepResearchSection): number {
  return new TextEncoder().encode(JSON.stringify(section)).length;
}
