export function normalizeInlineWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
