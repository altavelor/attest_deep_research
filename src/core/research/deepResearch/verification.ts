import type { RetrievedChunk } from "@core/model";
import type {
  ClaimAssessment,
  ClaimVerdict,
  ObjectiveCoverage,
  ResearchBranch,
  ResearchClaim,
  ResearchPlan,
  ResearchVerification,
  ResearchWork,
} from "./types";

export const MAX_RESEARCH_CLAIMS = 40;
export const MAX_CLAIM_TEXT_CHARS = 1000;
export const MAX_CLAIM_TOKENS = 8;
export const MAX_CLAIM_QUOTE_CHARS = 500;
export const MIN_CLAIM_QUOTE_CHARS = 20;

export interface ReferenceCheck {
  checkable: ResearchClaim[];
  settled: ClaimAssessment[];
}

/**
 * Checks claim citations against the evidence the registry resolved, without a model call. A
 * claim with no resolvable token is `unsupported`; a claim whose resolvable evidence is only
 * search snippets or metadata is `unresolved`; every other claim goes on to assessment.
 */
export function checkClaimReferences(
  claims: readonly ResearchClaim[],
  evidence: readonly RetrievedChunk[],
): ReferenceCheck {
  const byToken = new Map(evidence.map((chunk) => [chunk.id, chunk]));
  const groups = independenceGroups(evidence);
  const checkable: ResearchClaim[] = [];
  const settled: ClaimAssessment[] = [];
  for (const claim of claims) {
    const resolved = claim.citationTokens.flatMap((token) => {
      const chunk = byToken.get(token);
      return chunk ? [chunk] : [];
    });
    if (resolved.length === 0) {
      settled.push(assessment(claim.claimId, "unsupported", []));
    } else if (resolved.every((chunk) => !hasPassage(chunk))) {
      settled.push(assessment(claim.claimId, "unresolved", groupsOf(resolved, groups)));
    } else {
      checkable.push(claim);
    }
  }
  return { checkable, settled };
}

/**
 * Assigns every evidence token its independence group: evidence with the same normalized URL,
 * the same vault path or the same content hash is one source, so syndicated copies of one text
 * count once.
 */
export function independenceGroups(evidence: readonly RetrievedChunk[]): Map<string, string> {
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    let root = key;
    while (parent.get(root) !== root) root = parent.get(root) ?? root;
    parent.set(key, root);
    return root;
  };
  const union = (a: string, b: string): void => {
    for (const key of [a, b]) if (!parent.has(key)) parent.set(key, key);
    const [left, right] = [find(a), find(b)];
    if (left !== right) parent.set(right < left ? left : right, right < left ? right : left);
  };
  for (const chunk of evidence) {
    union(`token:${chunk.id}`, sourceKey(chunk));
    if (chunk.contentHash) union(`token:${chunk.id}`, `hash:${chunk.contentHash}`);
  }
  return new Map(evidence.map((chunk) => [chunk.id, `g-${fnv(find(`token:${chunk.id}`))}`]));
}

/** Marks an objective covered only when at least one supported claim serves it. */
export function objectiveCoverage(
  objectives: readonly string[],
  claims: readonly ResearchClaim[],
  assessments: readonly ClaimAssessment[],
): ObjectiveCoverage[] {
  const supported = new Set(
    assessments.filter((entry) => entry.verdict === "supported").map((entry) => entry.claimId),
  );
  return objectives.map((objective) => ({
    objective,
    covered: claims.some((claim) => claim.objective === objective && supported.has(claim.claimId)),
  }));
}

/**
 * Turns one untrusted verdict into an assessment; `passages` are exactly the passages of the
 * request that carried the claim. A `supported` verdict needs a quote of at least
 * `MIN_CLAIM_QUOTE_CHARS` normalized characters inside a passage of the claim's own tokens, and a
 * conflict needs a contradicting token among the request's passages; otherwise it is `unresolved`.
 */
export function acceptedAssessment(
  claim: ResearchClaim,
  verdict: { verdict: unknown; quote: unknown; contradicting: unknown } | null,
  passages: ReadonlyMap<string, string>,
  groups: ReadonlyMap<string, string>,
): ClaimAssessment {
  const cited = claim.citationTokens.filter((token) => passages.has(token));
  const claimGroups = [...new Set(cited.flatMap((token) => groups.get(token) ?? []))];
  if (verdict?.verdict === "supported") {
    const quote = containedQuote(
      verdict.quote,
      cited.map((token) => passages.get(token)!),
    );
    if (quote === null) return assessment(claim.claimId, "unresolved", claimGroups);
    return { ...assessment(claim.claimId, "supported", claimGroups), quote };
  }
  if (verdict?.verdict === "conflicted") {
    const contradicting = Array.isArray(verdict.contradicting)
      ? [
          ...new Set(
            verdict.contradicting.filter((token): token is string => passages.has(token as string)),
          ),
        ]
      : [];
    if (contradicting.length === 0) return assessment(claim.claimId, "unresolved", claimGroups);
    return {
      ...assessment(claim.claimId, "conflicted", claimGroups),
      contradictingTokens: contradicting.slice(0, MAX_CLAIM_TOKENS),
    };
  }
  const plain = verdict?.verdict === "unsupported" ? "unsupported" : "unresolved";
  return assessment(claim.claimId, plain, claimGroups);
}

/**
 * Returns a model quote bounded for storage when it holds at least `MIN_CLAIM_QUOTE_CHARS`
 * normalized characters and is contained in one of the passages, or null otherwise.
 */
export function containedQuote(quote: unknown, passages: readonly string[]): string | null {
  const text = typeof quote === "string" ? quote.trim() : "";
  const needle = normalized(unescaped(text));
  if (needle.length < MIN_CLAIM_QUOTE_CHARS) return null;
  if (!passages.some((passage) => normalized(passage).includes(needle))) return null;
  return text.slice(0, MAX_CLAIM_QUOTE_CHARS);
}

/** Returns the objectives a required enabled branch serves; the report is complete only when all are covered. */
export function requiredObjectives(plan: ResearchPlan): string[] {
  return plan.objectives.filter((objective) =>
    plan.branches.some(
      (branch) =>
        branch.enabled && branch.priority === "required" && branch.objectives.includes(objective),
    ),
  );
}

/**
 * Proposes at most one follow-up work per affected branch, within the remaining follow-up cap: a
 * branch serving an uncovered required objective, or a branch with a conflicted claim. Branches
 * that never completed a finding get none.
 */
export function followUpWorks(
  plan: ResearchPlan,
  verification: Pick<ResearchVerification, "claims" | "assessments" | "coverage">,
  completedBranches: readonly string[],
  remaining: number,
  cycle: number,
): ResearchWork[] {
  const required = new Set(requiredObjectives(plan));
  const uncovered = verification.coverage
    .filter((entry) => !entry.covered && required.has(entry.objective))
    .map((entry) => entry.objective);
  const conflicted = new Set(
    verification.assessments
      .filter((entry) => entry.verdict === "conflicted")
      .map((entry) => entry.claimId),
  );
  const works: ResearchWork[] = [];
  for (const branch of plan.branches) {
    if (works.length >= remaining || !completedBranches.includes(branch.branchId)) continue;
    const missing = uncovered.filter((objective) => branch.objectives.includes(objective));
    const conflicts = verification.claims.filter(
      (claim) => claim.branchId === branch.branchId && conflicted.has(claim.claimId),
    );
    if (missing.length === 0 && conflicts.length === 0) continue;
    works.push({
      workId: `${branch.branchId}-follow-up-${cycle}`,
      branchId: branch.branchId,
      cycle,
      kind: "follow-up",
      task: followUpTask(branch, missing, conflicts),
    });
  }
  return works;
}

function followUpTask(
  branch: ResearchBranch,
  missing: readonly string[],
  conflicts: readonly ResearchClaim[],
): string {
  return [
    `Follow up on "${branch.title}": ${branch.task}`,
    missing.length > 0 ? `Find cited evidence for: ${missing.join("; ")}.` : "",
    conflicts.length > 0
      ? `Resolve conflicting evidence about: ${conflicts.map((claim) => claim.text).join("; ")}.`
      : "",
  ]
    .filter((part) => part !== "")
    .join("\n");
}

function assessment(
  claimId: string,
  verdict: ClaimVerdict,
  independenceGroups: readonly string[],
): ClaimAssessment {
  return { claimId, verdict, quote: null, contradictingTokens: [], independenceGroups };
}

function groupsOf(
  chunks: readonly RetrievedChunk[],
  groups: ReadonlyMap<string, string>,
): string[] {
  return [...new Set(chunks.flatMap((chunk) => groups.get(chunk.id) ?? []))];
}

function hasPassage(chunk: RetrievedChunk): boolean {
  if (chunk.source.kind === "web" && !chunk.source.wasContentFetched) return false;
  return chunk.text.trim() !== "";
}

function sourceKey(chunk: RetrievedChunk): string {
  if (chunk.source.kind === "web") return `url:${normalizeUrl(chunk.source.url)}`;
  return `path:${chunk.source.path.toLowerCase()}`;
}

/**
 * Normalizes a URL to its source identity: scheme, userinfo, `www.`, a trailing host dot, the
 * default port, a trailing slash, `utm_*` parameters and the fragment are dropped and the host is
 * lowercased. Different remaining query strings stay different sources.
 */
function normalizeUrl(url: string): string {
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?/iu.exec(url.trim());
  if (!match) return url.trim().toLowerCase();
  const scheme = match[1]!.toLowerCase();
  const authority = match[2]!.slice(match[2]!.lastIndexOf("@") + 1).toLowerCase();
  const port = /:(\d+)$/u.exec(authority)?.[1];
  const defaultPort =
    (scheme === "http" && port === "80") || (scheme === "https" && port === "443");
  const host = (
    port !== undefined && defaultPort ? authority.slice(0, -port.length - 1) : authority
  )
    .replace(/^www\./u, "")
    .replace(/\.(?=$|:)/u, "");
  const query = (match[4] ?? "")
    .slice(1)
    .split("&")
    .filter((part) => part !== "" && !part.toLowerCase().startsWith("utm_"))
    .sort()
    .join("&");
  const path = (match[3] ?? "").replace(/\/+$/u, "");
  return `${host}${path}${query ? `?${query}` : ""}`;
}

function unescaped(text: string): string {
  return text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

function normalized(text: string): string {
  return text.replace(/\s+/gu, " ").trim().toLowerCase();
}

function fnv(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
