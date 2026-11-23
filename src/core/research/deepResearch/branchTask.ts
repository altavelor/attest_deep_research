import { branchLanguageInstruction } from "./researchLanguage";

export const SOURCE_READING_INSTRUCTION =
  "Open every web page you cite with fetch_web_page and read every note you cite before citing it. " +
  "A claim backed only by a search snippet cannot be verified and will be reported as unverified.";

/**
 * Returns the task a branch runner receives: the work's task followed by the source-reading rule
 * and the instruction to write the findings in the research language.
 */
export function branchTaskText(task: string, language: string): string {
  return `${task}\n\n${SOURCE_READING_INSTRUCTION}\n\n${branchLanguageInstruction(language)}`;
}
