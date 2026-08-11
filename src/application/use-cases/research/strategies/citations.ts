import { AnswerWebReference, WEB_REFERENCE_ID_PREFIX } from "@core/answer";
import { Citation } from "@core/model";
import { RetrievedChunk } from "@core/model";
import { CITATION_TOKEN_SOURCE, isCitationHandle } from "@core/research";
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

export function citationsForEvidence(
  evidence: RetrievedChunk[],
  citations: Citation[],
): Citation[] {
  const evidenceIds = new Set(evidence.map((chunk) => chunk.id));

  return citations.filter((citation) => evidenceIds.has(citation.id));
}

export function citationIdsFromText(text: string): Set<string> {
  return new Set(
    [...text.matchAll(/\[([^\]\n]{1,200})\]/g)].map((match) => match[1].trim()).filter(Boolean),
  );
}

export interface NormalizedCitationTokens {
  text: string;
  ids: Set<string>;

  collapsedOccurrences: number;

  collapsedByLabel: Record<string, number>;

  webReferences: AnswerWebReference[];
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
): NormalizedCitationTokens {
  const ids = new Set<string>();
  const webReferenceIdByUrl = new Map<string, string>();

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
    const token = match[1].trim();
    const destinationLength = markdownDestinationLength(text, start + match[0].length);
    let replacement: string;
    if (token.startsWith("url:")) {
      const validated = validatePublicWebUrl(token.slice("url:".length).trim());
      if (!validated.ok) continue;
      replacement = `[${resolveUrlToken(validated.url)}]`;
    } else {
      if (!isCitationHandle(token) || destinationLength > 0) continue;
      ids.add(token);
      replacement = `[${token}]`;
    }
    rewritten += text.slice(copiedUpTo, start) + replacement;
    copiedUpTo = start + match[0].length + destinationLength;
  }
  rewritten += text.slice(copiedUpTo);

  const collapsed = collapseAdjacentTokens(rewritten);
  return {
    text: collapsed.text,
    ids,
    collapsedOccurrences: collapsed.occurrences,
    collapsedByLabel: collapsed.byLabel,
    webReferences: [...webReferenceIdByUrl].map(([url, id]) => ({ id, url })),
  };
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
function collapseAdjacentTokens(text: string): {
  text: string;
  occurrences: number;
  byLabel: Record<string, number>;
} {
  let occurrences = 0;
  const countsByLabel = new Map<string, number>();
  return {
    text: text.replace(
      new RegExp(`(${CITATION_TOKEN_SOURCE})(?:[ \\t]*\\1)+`, "g"),
      (whole, first: string) => {
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
