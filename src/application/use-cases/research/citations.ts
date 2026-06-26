import { Citation } from "../../../core/model/citation";
import { RetrievedChunk } from "../../../core/model/source";

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

export function dedupeEvidence(evidence: readonly RetrievedChunk[]): RetrievedChunk[] {
  const seen = new Set<string>();
  return evidence.filter((chunk) => {
    if (seen.has(chunk.id)) return false;
    seen.add(chunk.id);
    return true;
  });
}
