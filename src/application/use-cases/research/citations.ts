import { Citation } from "../../../core/model/citation";
import { RetrievedChunk } from "../../../core/model/source";
import { validatePublicWebUrl } from "../../sources/WebUrlPolicy";

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

export interface ResolvedCitationTokens {
  /** Evidence ids the answer cites (URL tokens mapped to their registered id). */
  ids: Set<string>;
  /** Canonical URLs cited via `[url:…]` that were never gathered for this answer. */
  unresolvedUrls: string[];
}

/**
 * Resolve the answer's `[…]` citation tokens against gathered evidence. Models
 * cite web sources by `[url:https://…]` — a human-readable, derivable handle —
 * rather than opaque evidence ids. Each URL token is canonicalized the same way
 * the registry canonicalizes results, then mapped to its evidence id.
 */
export function resolveCitationTokens(
  text: string,
  urlToEvidenceId: ReadonlyMap<string, string>,
): ResolvedCitationTokens {
  const ids = new Set<string>();
  const unresolvedUrls = new Set<string>();

  for (const token of citationIdsFromText(text)) {
    if (!token.startsWith("url:")) {
      continue;
    }
    const validated = validatePublicWebUrl(token.slice("url:".length).trim());
    if (!validated.ok) continue; // malformed/unsafe URL — not a citation we can honor
    const evidenceId = urlToEvidenceId.get(validated.url);
    if (evidenceId) ids.add(evidenceId);
    else unresolvedUrls.add(validated.url);
  }

  return { ids, unresolvedUrls: [...unresolvedUrls] };
}

/**
 * Map canonical web URL → evidence id over gathered evidence, so the answer's
 * `[url:…]` citations can be resolved back to their registered ids. Non-web
 * chunks (index/notes) carry no URL and are skipped.
 */
export function webUrlEvidenceIndex(
  evidence: readonly RetrievedChunk[],
): Map<string, string> {
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
