/** Escapes untrusted text placed inside a tag-framed prompt so it cannot open or close a frame. */
export function escapePromptText(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
}
