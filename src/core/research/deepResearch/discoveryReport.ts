import type { ResearchHypothesis } from "./discoveryTypes";
import type { ResearchClaim, ResearchDiscovery } from "./types";
import { currentHypotheses } from "./discovery";
import { MAX_CLAIM_TOKENS } from "./verification";

/**
 * Returns the claims of kind hypothesis that enter verification: one per current hypothesis
 * revision with source observations, citing their tokens, at most `max` of them.
 */
export function hypothesisClaims(
  discovery: ResearchDiscovery | null,
  max: number,
): ResearchClaim[] {
  if (!discovery || max <= 0) return [];
  return currentHypotheses(discovery.hypotheses)
    .flatMap((hypothesis) => {
      const sources = sourceObservations(discovery, hypothesis);
      const tokens = [...new Set(sources.flatMap((entry) => entry.citationTokens))];
      if (tokens.length === 0) return [];
      return [
        {
          claimId: `c-${hypothesis.hypothesisId}-h${hypothesis.revision}`.slice(0, 64),
          workId: sources[0]!.testId,
          branchId: hypothesis.branchId,
          objective: null,
          text: hypothesis.claim,
          citationTokens: tokens.slice(0, MAX_CLAIM_TOKENS),
          kind: "hypothesis" as const,
        },
      ];
    })
    .slice(0, max);
}

/**
 * Renders the hypotheses section of a report. Support only from sources is labelled "supported by
 * literature" and never as validated; user observations carry their limitations; disconfirmed
 * revisions and the alternatives of surviving hypotheses are always listed.
 */
export function hypothesesSection(discovery: ResearchDiscovery | null): string {
  if (!discovery || discovery.hypotheses.length === 0) return "";
  const current = new Set(
    currentHypotheses(discovery.hypotheses).map(
      (entry) => `${entry.hypothesisId}#${entry.revision}`,
    ),
  );
  const lines = discovery.hypotheses
    .filter(
      (entry) =>
        entry.status === "disconfirmed" || current.has(`${entry.hypothesisId}#${entry.revision}`),
    )
    .map((entry) => {
      const label = labelOf(discovery, entry);
      const alternative =
        entry.status === "disconfirmed" ? "" : ` Alternative: ${inline(entry.alternative)}.`;
      return `- (${label}) ${inline(entry.claim)} (revision ${entry.revision}).${alternative}`;
    });
  const omissions = discovery.omissions.map((entry) => `- ${inline(entry)}`);
  return [
    "## Hypotheses",
    lines.join("\n"),
    ...(omissions.length > 0 ? ["Known omissions:", omissions.join("\n")] : []),
  ].join("\n\n");
}

function labelOf(discovery: ResearchDiscovery, hypothesis: ResearchHypothesis): string {
  if (hypothesis.status !== "supported") return hypothesis.status;
  const own = discovery.observations.filter((entry) =>
    hypothesis.observationIds.includes(entry.observationId),
  );
  const user = own.filter((entry) => entry.producer === "user");
  if (user.length === 0) return "supported by literature";
  const limitations = [...new Set(user.flatMap((entry) => entry.limitations))];
  return limitations.length === 0
    ? "supported by a user observation"
    : `supported by a user observation, ${limitations.join("; ")}`;
}

function sourceObservations(discovery: ResearchDiscovery, hypothesis: ResearchHypothesis) {
  return discovery.observations.filter(
    (entry) =>
      entry.producer === "source" && hypothesis.observationIds.includes(entry.observationId),
  );
}

function inline(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}
