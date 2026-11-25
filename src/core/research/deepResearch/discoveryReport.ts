import type { ResearchHypothesis } from "./discoveryTypes";
import type { ResearchClaim, ResearchDiscovery } from "./types";
import { USER_OBSERVATION_LIMITATION, currentHypotheses } from "./discovery";
import { label, type ResearchLabels } from "./reportLabels";
import { MAX_CLAIM_TOKENS } from "./verification";

/**
 * Returns the claims of kind hypothesis that enter verification: one per current supported
 * hypothesis revision with source observations, citing their tokens, at most `max` of them.
 */
export function hypothesisClaims(
  discovery: ResearchDiscovery | null,
  max: number,
): ResearchClaim[] {
  if (!discovery || max <= 0) return [];
  return currentHypotheses(discovery.hypotheses)
    .filter((hypothesis) => hypothesis.status === "supported")
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
 * revisions and the alternatives of surviving hypotheses are always listed. Every model- or
 * user-written text passes `clean` with the citation tokens of that hypothesis's own observations.
 */
export function hypothesesSection(
  discovery: ResearchDiscovery | null,
  labels: ResearchLabels,
  clean: (text: string, allowed: ReadonlySet<string>) => string = (text) => text,
): string {
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
      const allowed = new Set(
        discovery.observations
          .filter((observation) => entry.observationIds.includes(observation.observationId))
          .flatMap((observation) => observation.citationTokens),
      );
      const text = (value: string): string => inline(clean(value, allowed));
      const alternative =
        entry.status === "disconfirmed"
          ? ""
          : ` ${label(labels, "alternative", { text: text(entry.alternative) })}`;
      const line = label(labels, "hypothesisLine", {
        label: text(labelOf(discovery, entry, labels)),
        claim: text(entry.claim),
        revision: entry.revision,
      });
      return `- ${line}${alternative}`;
    });
  const omissions = discovery.omissions.map((entry) => `- ${inline(clean(entry, new Set()))}`);
  return [
    `## ${labels.hypotheses}`,
    lines.join("\n"),
    ...(omissions.length > 0 ? [labels.knownOmissions, omissions.join("\n")] : []),
  ].join("\n\n");
}

function labelOf(
  discovery: ResearchDiscovery,
  hypothesis: ResearchHypothesis,
  labels: ResearchLabels,
): string {
  const own = discovery.observations.filter((entry) =>
    hypothesis.observationIds.includes(entry.observationId),
  );
  const user = own.filter((entry) => entry.producer === "user");
  const status = statusLabel(hypothesis.status, labels);
  if (user.length === 0) {
    if (unsettled(hypothesis) && skippedTest(discovery, hypothesis)) {
      return label(labels, "skippedObservation", { status });
    }
    return hypothesis.status === "supported" ? labels.supportedByLiterature : status;
  }
  const limitations = [...new Set(user.flatMap((entry) => entry.limitations))].map((entry) =>
    entry === USER_OBSERVATION_LIMITATION ? labels.observationLimitation : entry,
  );
  return label(labels, "byUserObservation", { status, limitations: limitations.join("; ") });
}

function statusLabel(status: ResearchHypothesis["status"], labels: ResearchLabels): string {
  if (status === "supported") return labels.statusSupported;
  if (status === "disconfirmed") return labels.statusDisconfirmed;
  if (status === "inconclusive") return labels.statusInconclusive;
  return labels.statusUntested;
}

function unsettled(hypothesis: ResearchHypothesis): boolean {
  return hypothesis.status === "untested" || hypothesis.status === "inconclusive";
}

function skippedTest(discovery: ResearchDiscovery, hypothesis: ResearchHypothesis): boolean {
  return (
    discovery.observationsSkipped === true &&
    discovery.tests.some(
      (test) =>
        test.kind === "supplied-observation" &&
        test.status === "unavailable" &&
        test.hypothesisId === hypothesis.hypothesisId &&
        test.hypothesisRevision === hypothesis.revision,
    )
  );
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
