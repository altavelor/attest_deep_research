import type { ClaimAssessment, ObjectiveCoverage, ResearchClaim } from "./types";

export const MAX_RESEARCH_CLAIMS = 40;
export const MAX_CLAIM_TEXT_CHARS = 1000;
export const MAX_CLAIM_TOKENS = 8;
export const MAX_CLAIM_QUOTE_CHARS = 500;
export const MIN_CLAIM_QUOTE_CHARS = 20;

/** Marks an objective covered only when at least one supported claim serves it. */
export function objectiveCoverage(
  objectives: readonly string[],
  claims: readonly ResearchClaim[],
  assessments: readonly ClaimAssessment[],
): ObjectiveCoverage[] {
  const supported = new Set(
    assessments.filter((entry) => entry.verdict === "supported").map((entry) => entry.claimId),
  );
  return objectives.map((objective) => ({
    objective,
    covered: claims.some((claim) => claim.objective === objective && supported.has(claim.claimId)),
  }));
}

/**
 * Returns a model quote bounded for storage when it holds at least `MIN_CLAIM_QUOTE_CHARS`
 * normalized characters and is contained in one of the passages, or null otherwise.
 */
export function containedQuote(quote: unknown, passages: readonly string[]): string | null {
  const text = typeof quote === "string" ? quote.trim() : "";
  const needle = normalized(unescaped(text));
  if (needle.length < MIN_CLAIM_QUOTE_CHARS) return null;
  if (!passages.some((passage) => normalized(passage).includes(needle))) return null;
  return text.slice(0, MAX_CLAIM_QUOTE_CHARS);
}

function unescaped(text: string): string {
  return text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

function normalized(text: string): string {
  return text.replace(/\s+/gu, " ").trim().toLowerCase();
}
