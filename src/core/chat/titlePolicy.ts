const MAX_TITLE_CHARS = 80;
const TRUNCATED_TITLE_CHARS = 77;

/**
 * Collapses whitespace into single spaces and shortens text longer than 80 characters
 * to its first 77 characters followed by an ellipsis. Returns an empty string for blank text.
 */
export function condenseTitleText(text: string): string {
  const singleLine = text.trim().replace(/\s+/g, " ");
  return singleLine.length <= MAX_TITLE_CHARS
    ? singleLine
    : `${singleLine.slice(0, TRUNCATED_TITLE_CHARS)}...`;
}
