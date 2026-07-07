// Pure grouping for the claim index (SPEC-corpus R7). Given every source's claims
// and a query, return claims about the same subject gathered across documents —
// the pre-filtered candidate set an LLM judge then compares pair-by-pair. Kept
// pure (no I/O) so the retrieval capability is a thin wrapper and the matching is
// unit-testable.

import type {
  ClaimGroup,
  DocumentClaim,
  FindClaimsOptions,
  SourceDocumentClaims,
} from "@application/ports";

export function groupClaims(
  sources: readonly SourceDocumentClaims[],
  options: FindClaimsOptions,
): ClaimGroup[] {
  const limit = Math.max(1, Math.floor(options.limit));
  const subjectQuery = normalize(options.subject ?? "");
  const topicQuery = normalize(options.topic ?? "");

  const matched = sources
    .flatMap((source) => source.claims)
    .filter((claim) => matches(claim, subjectQuery, topicQuery));

  const bySubject = new Map<string, DocumentClaim[]>();
  for (const claim of matched) {
    const key = normalize(claim.subject) || "(unspecified)";
    const bucket = bySubject.get(key);
    if (bucket) {
      bucket.push(claim);
    } else {
      bySubject.set(key, [claim]);
    }
  }

  const groups: ClaimGroup[] = [...bySubject.entries()].map(([, claims]) => ({
    subject: claims[0].subject,
    sourcePaths: [...new Set(claims.map((claim) => claim.sourcePath))],
    claims,
  }));

  // Multi-document subjects first (contradiction candidates), then larger groups.
  groups.sort(
    (left, right) =>
      right.sourcePaths.length - left.sourcePaths.length ||
      right.claims.length - left.claims.length ||
      left.subject.localeCompare(right.subject),
  );

  // Bound the total number of claims returned across groups (keeps the tool
  // result small); drop a group entirely once the budget is spent.
  const bounded: ClaimGroup[] = [];
  let remaining = limit;
  for (const group of groups) {
    if (remaining <= 0) {
      break;
    }
    const claims = group.claims.slice(0, remaining);
    bounded.push({
      subject: group.subject,
      sourcePaths: [...new Set(claims.map((claim) => claim.sourcePath))],
      claims,
    });
    remaining -= claims.length;
  }
  return bounded;
}

function matches(claim: DocumentClaim, subjectQuery: string, topicQuery: string): boolean {
  if (!subjectQuery && !topicQuery) {
    return true;
  }
  const subject = normalize(claim.subject);
  const statement = normalize(claim.statement);
  const topics = claim.topicKeys.map(normalize);

  const subjectHit =
    !subjectQuery ||
    subject.includes(subjectQuery) ||
    subjectQuery.includes(subject) ||
    statement.includes(subjectQuery) ||
    topics.some((topic) => topic.includes(subjectQuery));
  const topicHit =
    !topicQuery ||
    topics.some((topic) => topic.includes(topicQuery) || topicQuery.includes(topic)) ||
    subject.includes(topicQuery);

  return subjectHit && topicHit;
}

function normalize(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, " ");
}
