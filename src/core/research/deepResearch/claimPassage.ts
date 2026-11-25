export const CLAIM_PASSAGE_CHARS = 6000;
const WINDOW_CHARS = 1500;
const GAP = "\n…\n";

/**
 * Cuts a long source to the part a claim checker needs: the opening window and the windows that
 * share the most terms with the claims, in document order and within `maxChars`. Terms are those
 * that survive translation, numbers of two or more digits, article references and Latin words, and
 * longer words of any script; a source within the bound is returned whole.
 */
export function claimPassage(
  text: string,
  claims: readonly string[],
  maxChars = CLAIM_PASSAGE_CHARS,
): string {
  if (text.length <= maxChars) return text;
  const windows: string[] = [];
  for (let start = 0; start < text.length; start += WINDOW_CHARS) {
    windows.push(text.slice(start, start + WINDOW_CHARS));
  }
  const terms = claimTerms(claims);
  const ranked = windows
    .map((window, index) => ({ index, score: termScore(window.toLowerCase(), terms) }))
    .slice(1)
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const room = Math.max(0, Math.floor(maxChars / WINDOW_CHARS) - 1);
  const chosen = [0, ...ranked.slice(0, room).map((entry) => entry.index)].sort(
    (left, right) => left - right,
  );
  return chosen.map((index) => windows[index]).join(GAP);
}

function claimTerms(claims: readonly string[]): Set<string> {
  const terms = new Set<string>();
  for (const claim of claims) {
    const lower = claim.toLowerCase();
    for (const match of lower.matchAll(/\d+\(\d+\)|\d{2,}/gu)) terms.add(match[0]);
    for (const match of lower.matchAll(/[a-z]{3,}/gu)) terms.add(match[0]);
    for (const match of lower.matchAll(/\p{L}{6,}/gu)) terms.add(match[0]);
  }
  return terms;
}

function termScore(window: string, terms: ReadonlySet<string>): number {
  let score = 0;
  for (const term of terms) {
    if (window.includes(term)) score += 1;
  }
  return score;
}
