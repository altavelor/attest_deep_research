import { AnswerWebReference, WEB_REFERENCE_ID_PREFIX } from "@core/answer";
import { Citation } from "@core/model";
import { RetrievedChunk } from "@core/model";
import {
  CITATION_TOKEN_SOURCE,
  isCitationHandle,
  isMarkdownCodeIndex,
  markdownCodeRanges,
} from "@core/research";
import { validatePublicWebUrl } from "@application/sources/WebUrlPolicy";

export function mergeCitations(primary: Citation[], secondary: Citation[]): Citation[] {
  const seen = new Set<string>();
  const citations: Citation[] = [];

  for (const citation of [...primary, ...secondary]) {
    if (!seen.has(citation.id)) {
      citations.push(citation);
      seen.add(citation.id);
    }
  }

  return citations;
}

export function mergeCitationRemovalCounts(
  primary: Readonly<Record<string, number>>,
  secondary: Readonly<Record<string, number>>,
): Record<string, number> {
  const merged = { ...primary };
  for (const [label, count] of Object.entries(secondary)) {
    merged[label] = (merged[label] ?? 0) + count;
  }
  return merged;
}

export function citationsForEvidence(
  evidence: RetrievedChunk[],
  citations: Citation[],
): Citation[] {
  const evidenceIds = new Set(evidence.map((chunk) => chunk.id));

  return citations.filter((citation) => evidenceIds.has(citation.id));
}

export function citationIdsFromText(
  text: string,
  citationLabels?: ReadonlySet<string>,
): Set<string> {
  return new Set(
    citationOccurrencesFromText(text, citationLabels).map((citation) => citation.label),
  );
}

export function citationOccurrencesFromText(
  text: string,
  citationLabels?: ReadonlySet<string>,
): Array<{ label: string; index: number }> {
  const codeRanges = markdownCodeRanges(text);
  const protectedStarts = protectedMarkdownBracketStarts(text, citationLabels);
  return [...text.matchAll(/\[([^\]\n]{1,200})\]/g)]
    .map((match) => ({
      label: match[1].trim(),
      index: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    }))
    .filter(
      (citation) =>
        citation.label.length > 0 &&
        !isMarkdownCodeIndex(citation.index, codeRanges) &&
        !protectedStarts.has(citation.index) &&
        markdownDestinationLength(text, citation.end) === 0,
    )
    .map(({ label, index }) => ({ label, index }));
}

export interface NormalizedCitationTokens {
  text: string;
  ids: Set<string>;

  collapsedOccurrences: number;

  collapsedByLabel: Record<string, number>;

  webReferences: AnswerWebReference[];
  rejectedTokens: string[];
}

export interface NormalizeCitationTokenOptions {
  allowUnregisteredWebReferences?: boolean;
}

const CITATION_TOKEN = /\[([^\]\n]{1,200})\]/g;

/**
 * Rewrite the answer's `[…]` citation tokens into a single handle form the
 * renderer can anchor. Models cite web sources by `[url:https://…]`; a URL that
 * maps to gathered evidence becomes that evidence id, one that does not becomes
 * a stable web-reference handle. A url token written as a markdown link loses
 * its destination too, so no link survives the rewrite. Handle-shaped tokens are
 * kept as cited ids, ordinary bracketed prose and genuine markdown links are
 * left untouched, and adjacent repeats of the same handle collapse into one.
 */
export function normalizeCitationTokens(
  text: string,
  urlToEvidenceId: ReadonlyMap<string, string>,
  options: NormalizeCitationTokenOptions = {},
): NormalizedCitationTokens {
  const ids = new Set<string>();
  const rejectedTokens = new Set<string>();
  const webReferenceIdByUrl = new Map<string, string>();
  const codeRanges = markdownCodeRanges(text);
  const protectedStarts = protectedMarkdownBracketStarts(text);

  const resolveUrlToken = (url: string): string => {
    const evidenceId = urlToEvidenceId.get(url);
    if (evidenceId) {
      ids.add(evidenceId);
      return evidenceId;
    }
    const existing = webReferenceIdByUrl.get(url);
    if (existing) return existing;
    const referenceId = `${WEB_REFERENCE_ID_PREFIX}${webReferenceIdByUrl.size + 1}`;
    webReferenceIdByUrl.set(url, referenceId);
    return referenceId;
  };

  let rewritten = "";
  let copiedUpTo = 0;
  for (const match of text.matchAll(CITATION_TOKEN)) {
    const start = match.index;
    if (start === undefined || start < copiedUpTo) continue;
    if (isMarkdownCodeIndex(start, codeRanges) || protectedStarts.has(start)) continue;
    const token = match[1].trim();
    const destinationLength = markdownDestinationLength(text, start + match[0].length);
    let replacement: string;
    if (token.startsWith("url:")) {
      const validated = validatePublicWebUrl(token.slice("url:".length).trim());
      if (!validated.ok) {
        rejectedTokens.add(token);
        replacement = "";
      } else if (
        !urlToEvidenceId.has(validated.url) &&
        options.allowUnregisteredWebReferences === false
      ) {
        rejectedTokens.add(token);
        replacement = "";
      } else {
        replacement = `[${resolveUrlToken(validated.url)}]`;
      }
    } else {
      if (!isCitationHandle(token) || destinationLength > 0) continue;
      ids.add(token);
      replacement = `[${token}]`;
    }
    rewritten += text.slice(copiedUpTo, start) + replacement;
    copiedUpTo = start + match[0].length + destinationLength;
  }
  rewritten += text.slice(copiedUpTo);

  const collapsed = collapseAdjacentTokens(
    rewritten,
    markdownCodeRanges(rewritten),
    protectedMarkdownBracketStarts(rewritten),
  );
  return {
    text: collapsed.text,
    ids,
    collapsedOccurrences: collapsed.occurrences,
    collapsedByLabel: collapsed.byLabel,
    webReferences: [...webReferenceIdByUrl].map(([url, id]) => ({ id, url })),
    rejectedTokens: [...rejectedTokens],
  };
}

/** Removes citation-looking tokens that cannot be resolved to a registered source. */
export function removeUnknownCitationTokens(
  text: string,
  knownCitationIds: ReadonlySet<string>,
): string {
  const codeRanges = markdownCodeRanges(text);
  return text.replace(CITATION_TOKEN, (whole, inner: string, start: number) => {
    const token = inner.trim();
    const end = start + whole.length;
    const markdownProtected =
      text[start - 1] === "!" ||
      markdownDestinationLength(text, end) > 0 ||
      text[end] === "[" ||
      text[start - 1] === "]" ||
      text.slice(end).match(/^[ \t]*:/u) !== null;
    if (markdownProtected || isMarkdownCodeIndex(start, codeRanges)) return whole;
    return isCitationHandle(token) && !knownCitationIds.has(token) ? "" : whole;
  });
}

function protectedMarkdownBracketStarts(
  text: string,
  citationLabels?: ReadonlySet<string>,
): Set<number> {
  const protectedStarts = new Set<number>();
  const definitions = new Set<string>();
  for (const match of text.matchAll(/^ {0,3}\[([^\]\n]+)\]:[ \t]*\S+/gm)) {
    definitions.add(normalizeReferenceId(match[1]));
    protectedStarts.add((match.index ?? 0) + match[0].indexOf("["));
  }
  for (const match of text.matchAll(/!?\[([^\]\n]*)\]\[([^\]\n]*)\]/g)) {
    const firstStart = (match.index ?? 0) + (match[0].startsWith("!") ? 1 : 0);
    const secondStart = text.indexOf("[", firstStart + 1);
    const referenceId = normalizeReferenceId(match[2] || match[1]);
    const secondLabel = match[2].trim();
    const clearlyReference =
      match[0].startsWith("!") ||
      secondLabel.length === 0 ||
      definitions.has(referenceId) ||
      (citationLabels !== undefined && !citationLabels.has(secondLabel));
    if (!clearlyReference) continue;
    protectedStarts.add(firstStart);
    if (secondStart >= 0) protectedStarts.add(secondStart);
  }
  return protectedStarts;
}

function normalizeReferenceId(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Length of the markdown link destination starting at `index`, or 0 when there
 * is none. Parentheses nest, as in a Wikipedia disambiguator, and a backslash
 * escapes the character after it; whitespace ends a destination, so ordinary
 * parenthesised prose after a token is never consumed.
 */
function markdownDestinationLength(text: string, index: number): number {
  if (text[index] !== "(") return 0;
  let depth = 0;
  for (let cursor = index; cursor < text.length; cursor += 1) {
    const character = text[cursor];
    if (character === "\\") {
      cursor += 1;
      continue;
    }
    if (/\s/.test(character)) return 0;
    if (character === "(") depth += 1;
    else if (character === ")") {
      depth -= 1;
      if (depth === 0) return cursor - index + 1;
    }
  }
  return 0;
}

/**
 * Collapses a run of the same handle repeated with only whitespace between the
 * brackets, which is what a link and an evidence id for one source become once
 * both are normalized to the same token.
 */
function collapseAdjacentTokens(
  text: string,
  codeRanges: ReturnType<typeof markdownCodeRanges>,
  protectedStarts: ReadonlySet<number>,
): {
  text: string;
  occurrences: number;
  byLabel: Record<string, number>;
} {
  let occurrences = 0;
  const countsByLabel = new Map<string, number>();
  return {
    text: text.replace(
      new RegExp(`(${CITATION_TOKEN_SOURCE})(?:[ \\t]*\\1)+`, "g"),
      (whole, first: string, _label: string, start: number) => {
        if (isMarkdownCodeIndex(start, codeRanges) || protectedStarts.has(start)) return whole;
        const collapsedCount = Math.max(
          0,
          (whole.match(new RegExp(CITATION_TOKEN_SOURCE, "g")) ?? []).length - 1,
        );
        occurrences += collapsedCount;
        const label = first.slice(1, -1);
        countsByLabel.set(label, (countsByLabel.get(label) ?? 0) + collapsedCount);
        return first;
      },
    ),
    occurrences,
    byLabel: Object.fromEntries(countsByLabel),
  };
}

/**
 * Map canonical web URL → evidence id over gathered evidence, so the answer's
 * `[url:…]` citations can be resolved back to their registered ids. Non-web
 * chunks (index/notes) carry no URL and are skipped.
 */
export function webUrlEvidenceIndex(evidence: readonly RetrievedChunk[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const chunk of evidence) {
    if (chunk.source.kind !== "web") continue;
    const validated = validatePublicWebUrl(chunk.source.url);
    if (validated.ok) index.set(validated.url, chunk.id);
  }
  return index;
}

export function dedupeEvidence(evidence: readonly RetrievedChunk[]): RetrievedChunk[] {
  const seen = new Set<string>();
  return evidence.filter((chunk) => {
    if (seen.has(chunk.id)) return false;
    seen.add(chunk.id);
    return true;
  });
}
