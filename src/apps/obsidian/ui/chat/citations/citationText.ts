/**
 * Shape of a rendered citation handle: a bracketed run of at least eight
 * non-space characters. Ordinary bracketed prose contains spaces and is left
 * alone, so `[Important note]` survives while a stale handle does not.
 */
export const CITATION_TOKEN_SOURCE = "\\[([^\\]\\n\\s]{8,})\\]";

export function stripRenderedCitationIds(value: string): string {
  return value.replace(new RegExp(`\\s*${CITATION_TOKEN_SOURCE}`, "g"), "");
}
