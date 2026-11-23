export const SOURCE_READING_INSTRUCTION =
  "Open every web page you cite with fetch_web_page and read every note you cite before citing it. " +
  "A claim backed only by a search snippet cannot be verified and will be reported as unverified.";

/** Returns the task a branch runner receives: the work's task followed by the source-reading rule. */
export function branchTaskText(task: string): string {
  return `${task}\n\n${SOURCE_READING_INSTRUCTION}`;
}
