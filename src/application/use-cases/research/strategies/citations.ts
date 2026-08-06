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

  webReferences: AnswerWebReference[];
}

const CITATION_TOKEN = /\[([^\]\n]{1,200})\]/g;

/**
 * Rewrite the answer's `[…]` citation tokens into a single handle form the
 * renderer can anchor. Models cite web sources by `[url:https://…]`; a URL that
 * maps to gathered evidence becomes that evidence id, one that does not becomes
 * a stable web-reference handle. Handle-shaped tokens are kept as cited ids,
 * ordinary bracketed prose is left untouched, and adjacent repeats of the same
 * handle collapse into one.
 */
export function normalizeCitationTokens(
  text: string,
  urlToEvidenceId: ReadonlyMap<string, string>,
): NormalizedCitationTokens {
  const ids = new Set<string>();
  const webReferenceIdByUrl = new Map<string, string>();

  const rewritten = text.replace(CITATION_TOKEN, (whole, inner: string, offset: number) => {
    const token = inner.trim();
    if (!token.startsWith("url:")) {
      if (!isCitationHandle(token) || text[offset + whole.length] === "(") return whole;
      ids.add(token);
      return `[${token}]`;
    }
    const validated = validatePublicWebUrl(token.slice("url:".length).trim());
    if (!validated.ok) return whole;
    const evidenceId = urlToEvidenceId.get(validated.url);
    if (evidenceId) {
      ids.add(evidenceId);
      return `[${evidenceId}]`;
    }
    const existing = webReferenceIdByUrl.get(validated.url);
    if (existing) return `[${existing}]`;
    const referenceId = `${WEB_REFERENCE_ID_PREFIX}${webReferenceIdByUrl.size + 1}`;
    webReferenceIdByUrl.set(validated.url, referenceId);
    return `[${referenceId}]`;
  });

  return {
    text: collapseAdjacentTokens(rewritten),
    ids,
    webReferences: [...webReferenceIdByUrl].map(([url, id]) => ({ id, url })),
  };
}

/**
 * Collapses a run of the same handle repeated with only whitespace between the
 * brackets, which is what a link and an evidence id for one source become once
 * both are normalized to the same token.
 */
function collapseAdjacentTokens(text: string): string {
  return text.replace(
    new RegExp(`(${CITATION_TOKEN_SOURCE})(?:[ \\t]*\\1)+`, "g"),
    (_whole, first: string) => first,
  );
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
