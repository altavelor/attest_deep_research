// Pure bibliography logic (SPEC-corpus-knowledge R3): reference normalization
// and shared-reference computation across document metadata. No I/O.

import {
  DocumentReference,
  DocumentReferenceNormalized,
  SharedReference,
  SourceDocumentMetadata,
} from "@application/ports";

const DOI_PATTERN = /\b10\.\d{4,9}\/[^\s"'<>)\],;]+/i;
const YEAR_PATTERN = /\b(19|20)\d{2}\b/;

/**
 * Best-effort normalization of a raw reference string. DOI wins when present;
 * otherwise a lowercased, punctuation-free title key plus the year makes
 * references comparable across documents.
 */
export function normalizeReference(raw: string): DocumentReferenceNormalized | undefined {
  const doi = DOI_PATTERN.exec(raw)?.[0]?.replace(/[.,;]+$/, "");
  const yearMatch = YEAR_PATTERN.exec(raw);
  const title = referenceTitleKey(raw);

  if (!doi && !title && !yearMatch) {
    return undefined;
  }

  return {
    ...(title ? { title } : {}),
    ...(yearMatch ? { year: Number(yearMatch[0]) } : {}),
    ...(doi ? { doi: doi.toLowerCase() } : {}),
  };
}

export function toDocumentReference(raw: string): DocumentReference {
  const normalized = normalizeReference(raw);
  return { raw: raw.trim(), ...(normalized ? { normalized } : {}) };
}

/** References cited by at least `minSources` distinct documents. */
export function sharedReferences(
  documents: SourceDocumentMetadata[],
  minSources: number,
): SharedReference[] {
  const byKey = new Map<string, { reference: string; doi?: string; citedBy: Set<string> }>();

  for (const document of documents) {
    for (const reference of document.references) {
      const key = referenceMatchKey(reference);
      if (!key) {
        continue;
      }
      const entry = byKey.get(key) ?? {
        reference: reference.raw,
        ...(reference.normalized?.doi ? { doi: reference.normalized.doi } : {}),
        citedBy: new Set<string>(),
      };
      entry.citedBy.add(document.sourcePath);
      byKey.set(key, entry);
    }
  }

  return Array.from(byKey.entries())
    .filter(([, entry]) => entry.citedBy.size >= Math.max(2, minSources))
    .map(([key, entry]) => ({
      key,
      reference: entry.reference,
      ...(entry.doi ? { doi: entry.doi } : {}),
      citedBy: Array.from(entry.citedBy).sort(),
    }))
    .sort(
      (left, right) =>
        right.citedBy.length - left.citedBy.length || left.key.localeCompare(right.key),
    );
}

function referenceMatchKey(reference: DocumentReference): string | undefined {
  const normalized = reference.normalized;
  if (normalized?.doi) {
    return `doi:${normalized.doi}`;
  }
  if (normalized?.title) {
    return `title:${normalized.title}${normalized.year ? `:${normalized.year}` : ""}`;
  }
  return undefined;
}

/**
 * Title key: the longest run of words before a year/venue marker, lowercased
 * and stripped of punctuation. Crude, but stable across citation styles for
 * the common "Authors. Title. Venue, Year." shapes.
 */
function referenceTitleKey(raw: string): string | undefined {
  const cleaned = raw
    .toLowerCase()
    .replace(DOI_PATTERN, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned.split(" ").filter((word) => word.length > 1 && !YEAR_PATTERN.test(word));

  if (words.length < 4) {
    return undefined;
  }

  return words.slice(0, 12).join(" ");
}
