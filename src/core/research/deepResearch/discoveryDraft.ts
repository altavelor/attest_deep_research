import type { ResearchHypothesis, ResearchTestKind, ObservationVerdict } from "./discoveryTypes";
import type { ResearchPlan } from "./types";
import { acceptHypothesisDraft, type HypothesisDraft } from "./discovery";
import { discoveryText } from "./discoveryBounds";
import { containedQuote } from "./verification";

export interface HypothesisProposal {
  draft: HypothesisDraft;
  revises: string | null;
  test: { kind: ResearchTestKind; method: string };
}

export interface ParsedProposals {
  proposals: HypothesisProposal[];
  omissions: string[];
}

/**
 * Parses the untrusted reply of a hypothesis proposal. A hypothesis lacking a claim, alternative,
 * prediction or disconfirmation criterion is dropped; one bound to no enabled approved branch
 * becomes a known omission; a revision may only name a current hypothesis that is not settled.
 */
export function parseHypothesisProposals(
  reply: string,
  plan: ResearchPlan,
  current: readonly ResearchHypothesis[],
  max: number,
): ParsedProposals {
  const raw = firstJsonObject(reply);
  const result: ParsedProposals = { proposals: [], omissions: [] };
  if (!raw || !Array.isArray(raw.hypotheses)) return result;
  const branches = plan.branches.filter((branch) => branch.enabled);
  const revisable = new Set(
    current
      .filter((entry) => entry.status === "inconclusive" || entry.status === "untested")
      .map((entry) => entry.hypothesisId),
  );
  for (const entry of raw.hypotheses) {
    if (!isRecord(entry) || result.proposals.length >= max) continue;
    const branch = Number.isSafeInteger(entry.branch)
      ? branches[(entry.branch as number) - 1]
      : undefined;
    const draft = acceptHypothesisDraft({ ...entry, branchId: branch?.branchId ?? "-" });
    if (!draft) continue;
    if (!branch) {
      result.omissions.push(discoveryText(`Hypothesis outside every branch: ${draft.claim}`));
      continue;
    }
    const test = isRecord(entry.test) ? entry.test : {};
    const method = typeof test.method === "string" ? discoveryText(test.method) : "";
    const revises =
      typeof entry.revises === "string" && revisable.has(entry.revises) ? entry.revises : null;
    if (revises) revisable.delete(revises);
    result.proposals.push({
      draft,
      revises,
      test: {
        kind: test.kind === "observation" ? "supplied-observation" : "literature-check",
        method: method === "" ? discoveryText(draft.prediction) : method,
      },
    });
  }
  return result;
}

/**
 * Parses the untrusted verdict of an assessment. A supporting or contradicting verdict stands only
 * with a quote contained in one of the passages; otherwise the observation is inconclusive.
 */
export function parseObservationVerdict(
  reply: string,
  passages: readonly string[],
): { verdict: ObservationVerdict; quote: string | null } {
  const raw = firstJsonObject(reply);
  const verdict = raw?.verdict;
  if (verdict !== "supports" && verdict !== "contradicts") {
    return { verdict: "inconclusive", quote: null };
  }
  const quote = containedQuote(raw?.quote, passages);
  return quote === null
    ? { verdict: "inconclusive", quote: null }
    : { verdict, quote: discoveryText(quote, 300) };
}

function firstJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const value: unknown = JSON.parse(text.slice(start, end + 1));
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
