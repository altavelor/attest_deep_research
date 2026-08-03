import type { ImageCandidate, ImageCandidateOrigin } from "./imageCandidate";

const MIN_TERM_LENGTH = 3;

const JUNK_NAME = /(logo|icon|sprite|avatar|banner|placeholder|spacer|thumb_default|no[-_]image)/i;

const ORIGIN_WEIGHT: Record<ImageCandidateOrigin, number> = {
  document: 2,
  provider: 1,
  page: 0.5,
};

const WEIGHTS = {
  termOverlap: 4,
  licensed: 1.5,
  goodSize: 1,
  tinySize: -1.5,
  extremeAspect: -1.5,
  junkName: -2,
} as const;

const GOOD_PIXELS = { min: 120_000, max: 16_000_000 } as const;
const EXTREME_ASPECT = 4;

export const RELEVANCE_CUTOFF = {
  relativeToBest: 0.55,
  absolute: 0,
} as const;

export interface ScoredImageCandidate {
  candidate: ImageCandidate;
  score: number;
}

/**
 * Scores candidates against the query, drops duplicates and the irrelevant
 * tail, then caps the result at `limit`. Ties keep the original order, so a
 * provider's own ranking still breaks ties within an equally-scored group.
 */
export function rankImageCandidates(
  candidates: readonly ImageCandidate[],
  query: string,
  limit: number,
): ImageCandidate[] {
  const terms = queryTerms(query);
  const scored: Array<ScoredImageCandidate & { index: number }> = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const key = dedupeKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    scored.push({
      candidate,
      score: scoreImageCandidate(candidate, terms),
      index: scored.length,
    });
  }
  if (scored.length === 0) return [];

  const best = Math.max(...scored.map((entry) => entry.score));
  const floor = Math.max(RELEVANCE_CUTOFF.absolute, best * RELEVANCE_CUTOFF.relativeToBest);

  return scored
    .filter((entry) => entry.score >= floor)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.candidate);
}

export function scoreImageCandidate(candidate: ImageCandidate, terms: ReadonlySet<string>): number {
  let score = ORIGIN_WEIGHT[candidate.origin];
  score += WEIGHTS.termOverlap * termOverlap(candidate, terms);
  if (candidate.licensed === true) score += WEIGHTS.licensed;

  const { width, height } = candidate;
  if (width !== undefined && height !== undefined) {
    const pixels = width * height;
    if (pixels >= GOOD_PIXELS.min && pixels <= GOOD_PIXELS.max) score += WEIGHTS.goodSize;
    if (pixels < GOOD_PIXELS.min) score += WEIGHTS.tinySize;
    const aspect = width / height;
    if (aspect > EXTREME_ASPECT || aspect < 1 / EXTREME_ASPECT) score += WEIGHTS.extremeAspect;
  }

  if (JUNK_NAME.test(candidateFileName(candidate))) score += WEIGHTS.junkName;
  return score;
}

/** Share of query terms present in the candidate's own text, in 0..1. */
function termOverlap(candidate: ImageCandidate, terms: ReadonlySet<string>): number {
  if (terms.size === 0) return 0;
  const haystack = [
    candidate.alt,
    candidate.caption ?? "",
    candidate.sourceLabel,
    candidateFileName(candidate),
  ]
    .join(" ")
    .toLowerCase();

  let matched = 0;
  for (const term of terms) {
    if (haystack.includes(term)) matched += 1;
  }
  return matched / terms.size;
}

export function queryTerms(query: string): Set<string> {
  return new Set(
    query
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((term) => term.length >= MIN_TERM_LENGTH),
  );
}

function candidateFileName(candidate: ImageCandidate): string {
  const source =
    candidate.fullUrl ?? candidate.thumbnailUrl ?? candidate.vaultSource?.locator ?? "";
  const decoded = safeDecode(source.split(/[?#]/)[0] ?? "");
  return decoded.split("/").at(-1) ?? "";
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Same picture reached through two resources must not occupy two cards. */
function dedupeKey(candidate: ImageCandidate): string {
  if (candidate.vaultSource) {
    return `vault:${candidate.vaultSource.documentPath}#${candidate.vaultSource.locator}`;
  }
  const url = candidate.fullUrl ?? candidate.thumbnailUrl ?? candidate.id;
  return `url:${url
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "")
    .toLowerCase()}`;
}
