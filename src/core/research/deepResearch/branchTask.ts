import { branchLanguageInstruction } from "./researchLanguage";

export const SOURCE_READING_INSTRUCTION =
  "Open every web page you cite with fetch_web_page and read every note you cite before citing it. " +
  "When fetch_web_page reports a large page, search it with find_in_pages and read the passage with read_page_range. " +
  "Cite only text you have read, and say a page was not read only when a tool returned an error for it.";

/**
 * Returns the task a branch runner receives: the work's task followed by the source-reading rule
 * and the instruction to write the findings in the research language.
 */
export function branchTaskText(task: string, language: string): string {
  return `${task}\n\n${SOURCE_READING_INSTRUCTION}\n\n${branchLanguageInstruction(language)}`;
}
