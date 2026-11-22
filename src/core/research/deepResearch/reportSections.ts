import { requiredObjectives } from "./verification";
import type {
  BranchExecution,
  ClaimAssessment,
  ReportVerificationCounts,
  ResearchClaim,
  ResearchPlan,
  ResearchVerification,
} from "./types";

export interface VerifiedClaim {
  claim: ResearchClaim;
  assessment: ClaimAssessment;
}

/** Pairs every assessed claim with its assessment; a claim no check reached is left out. */
export function verifiedClaims(verification: ResearchVerification): VerifiedClaim[] {
  const byId = new Map(verification.assessments.map((entry) => [entry.claimId, entry]));
  return verification.claims.flatMap((claim) => {
    const assessment = byId.get(claim.claimId);
    return assessment ? [{ claim, assessment }] : [];
  });
}

/** Tells whether every extracted claim was assessed, by the model or by the reference check. */
export function fullyAssessed(verification: ResearchVerification): boolean {
  const assessed = new Set(verification.assessments.map((entry) => entry.claimId));
  return verification.claims.every((claim) => assessed.has(claim.claimId));
}

/** Counts the verdicts of a verification and names the required objectives it left uncovered. */
export function verificationCounts(
  plan: ResearchPlan,
  verification: ResearchVerification,
): ReportVerificationCounts {
  const verdicts = verifiedClaims(verification).map((entry) => entry.assessment.verdict);
  const count = (verdict: ClaimAssessment["verdict"]): number =>
    verdicts.filter((entry) => entry === verdict).length;
  return {
    supported: count("supported"),
    conflicted: count("conflicted"),
    unsupported: count("unsupported"),
    unresolved: count("unresolved"),
    uncoveredObjectives: uncoveredRequired(plan, verification),
  };
}

/** Returns the required objectives no supported claim covers, in plan order. */
export function uncoveredRequired(
  plan: ResearchPlan,
  verification: ResearchVerification,
): string[] {
  const covered = new Set(
    verification.coverage.filter((entry) => entry.covered).map((entry) => entry.objective),
  );
  return requiredObjectives(plan).filter((objective) => !covered.has(objective));
}

/** Lists the supported claims with their citations, one bullet per claim. */
export function supportedClaimsSection(verification: ResearchVerification): string {
  const supported = verifiedClaims(verification).filter(
    (entry) => entry.assessment.verdict === "supported",
  );
  return supported
    .map((entry) => `- ${inline(entry.claim.text)} ${citations(entry.claim)}`)
    .join("\n");
}

/**
 * Builds the honest sections every verified report ends with: conflicts with both sides, claims
 * that are unsupported or unresolved, findings of every work whose claims were not extracted,
 * uncovered objectives and the stop reason. Empty sections are left out.
 */
export function verificationSections(
  plan: ResearchPlan,
  executions: readonly BranchExecution[],
  verification: ResearchVerification,
  stopReason: string,
): string {
  const entries = verifiedClaims(verification);
  const conflicts = entries
    .filter((entry) => entry.assessment.verdict === "conflicted")
    .map(
      (entry) =>
        `- ${inline(entry.claim.text)} — cited ${citations(entry.claim)}; contradicted by ${entry.assessment.contradictingTokens
          .map((token) => `[${token}]`)
          .join(" ")}`,
    );
  const weak = entries
    .filter(
      (entry) =>
        entry.assessment.verdict === "unsupported" || entry.assessment.verdict === "unresolved",
    )
    .map((entry) => `- (${entry.assessment.verdict}) ${inline(entry.claim.text)}`);
  const assessed = new Set(entries.map((entry) => entry.claim.claimId));
  const checked = (workId: string): boolean => {
    const own = verification.claims.filter((claim) => claim.workId === workId);
    return (
      verification.verifiedWorks.includes(workId) &&
      (own.length === 0 || own.some((claim) => assessed.has(claim.claimId)))
    );
  };
  const unverified = [...executions, ...verification.followUps]
    .filter((execution) => execution.finding && !checked(execution.workId))
    .map(
      (execution) =>
        `### ${titleOf(plan, execution.branchId)}\n\n${execution.finding!.text.trim()}`,
    );
  const uncovered = uncoveredRequired(plan, verification).map(
    (objective) => `- ${inline(objective)}`,
  );
  return [
    ...(conflicts.length > 0 ? ["## Conflicting evidence", conflicts.join("\n")] : []),
    ...(weak.length > 0 ? ["## Unsupported or unresolved claims", weak.join("\n")] : []),
    ...(unverified.length > 0 ? ["## Unverified findings", ...unverified] : []),
    ...(uncovered.length > 0 ? ["## Uncovered objectives", uncovered.join("\n")] : []),
    `Stop reason: ${stopReason}`,
  ].join("\n\n");
}

function inline(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function citations(claim: ResearchClaim): string {
  return claim.citationTokens.map((token) => `[${token}]`).join(" ");
}

function titleOf(plan: ResearchPlan, branchId: string): string {
  return plan.branches.find((branch) => branch.branchId === branchId)?.title ?? branchId;
}
