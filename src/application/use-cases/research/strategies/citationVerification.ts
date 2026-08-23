import { RetrievedChunk } from "@core/model";
import { markdownBracketOccurrences } from "@core/research";
import { validatePublicWebUrl } from "@application/sources/WebUrlPolicy";

const SHINGLE_SIZE = 3;
const OVERLAP_THRESHOLD = 0.18;

const MIN_CLAIM_SHINGLES = 3;

const CLAIM_WINDOW_CHARS = 240;

export interface CitationVerificationOptions {
  urlToEvidenceId: ReadonlyMap<string, string>;
  onCitation?: (citation: { label: string; index: number }) => void;
}

/**
 * Returns the distinct evidence ids whose surrounding claim does not lexically
 * overlap the cited chunk. Only chunks present in `evidence` are checked; unknown
 * ids are handled separately (unknownCitationIds).
 */
export function verifyCitations(
  answerText: string,
  evidence: readonly RetrievedChunk[],
  options: CitationVerificationOptions,
): string[] {
  const chunkShingles = new Map<string, Set<string>>();
  for (const chunk of evidence) {
    chunkShingles.set(chunk.id, shingles(chunk.text));
  }

  const unverified = new Set<string>();
  const verified = new Set<string>();

  const evidenceIds = new Set(evidence.map((chunk) => chunk.id));
  for (const occurrence of markdownBracketOccurrences(answerText, evidenceIds)) {
    const token = occurrence.label;
    options.onCitation?.({ label: token, index: occurrence.index });
    const evidenceId = resolveToken(token, options.urlToEvidenceId);
    if (!evidenceId) {
      continue;
    }
    const target = chunkShingles.get(evidenceId);
    if (!target || verified.has(evidenceId)) {
      continue;
    }

    const claimStart = Math.max(0, occurrence.index - CLAIM_WINDOW_CHARS);
    const claim = answerText.slice(claimStart, occurrence.index);
    const claimShingles = shingles(claim);
    if (claimShingles.size < MIN_CLAIM_SHINGLES) {
      continue;
    }

    if (overlapRatio(claimShingles, target) >= OVERLAP_THRESHOLD) {
      verified.add(evidenceId);
      unverified.delete(evidenceId);
    } else {
      unverified.add(evidenceId);
    }
  }

  return [...unverified];
}

function resolveToken(token: string, urlToEvidenceId: ReadonlyMap<string, string>): string | null {
  if (token.startsWith("url:")) {
    const validated = validatePublicWebUrl(token.slice("url:".length).trim());
    return validated.ok ? (urlToEvidenceId.get(validated.url) ?? null) : null;
  }
  return token;
}

function overlapRatio(claim: Set<string>, chunk: Set<string>): number {
  let shared = 0;
  for (const shingle of claim) {
    if (chunk.has(shingle)) {
      shared += 1;
    }
  }
  return claim.size === 0 ? 0 : shared / claim.size;
}

function shingles(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 2);
  const result = new Set<string>();
  if (tokens.length < SHINGLE_SIZE) {
    for (const token of tokens) {
      result.add(token);
    }
    return result;
  }
  for (let index = 0; index + SHINGLE_SIZE <= tokens.length; index += 1) {
    result.add(tokens.slice(index, index + SHINGLE_SIZE).join(" "));
  }
  return result;
}
