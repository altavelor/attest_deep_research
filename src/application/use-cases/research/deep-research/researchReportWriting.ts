import type { RetrievedChunk } from "@core/model";
import {
  formatWithoutModel,
  label,
  verificationSections,
  verifiedClaims,
  type BranchExecution,
  type ResearchLabels,
  type ResearchPlan,
  type ResearchVerification,
} from "@core/research/deepResearch";
import type { ReportSynthesisService } from "./ReportSynthesisService";
import { removeUnknownCitationTokens } from "../strategies/citations";

export interface ReportWritingInput {
  question: string;
  plan: ResearchPlan;
  executions: readonly BranchExecution[];
  verification: ResearchVerification | null;
  stopReason: string;
  labels: ResearchLabels;
  synthesis: ReportSynthesisService;
  spendRound(): boolean;
  resolveEvidence?(revisionIds: readonly string[]): RetrievedChunk[];
  signal?: AbortSignal;
  onText?(markdown: string): void;
}

/**
 * Writes the report markdown. Verified claims are synthesized with the model when a finalization
 * round remains and at least one claim is supported, and the verification sections follow; without
 * a round the assessments are formatted without a model. Without assessments or without a supported
 * claim the findings are listed unverified with their unresolvable citations removed.
 */
export async function writeReportMarkdown(input: ReportWritingInput): Promise<string> {
  const { plan, verification, stopReason, labels } = input;
  if (!verification || verification.assessments.length === 0) {
    const cited = registryCitedFindings(input.executions, input.resolveEvidence);
    return withCitationNotes(
      formatWithoutModel(plan, cited.executions, stopReason, null, labels),
      {
        removedTokens: cited.removedTokens,
        unverifiedTokens: 0,
      },
      labels,
    );
  }
  const cited = registryCitedFindings(input.executions, input.resolveEvidence);
  const removedTokens = cited.removedTokens;
  const claims = verifiedClaims(verification).filter(
    (entry) =>
      entry.assessment.verdict === "supported" || entry.assessment.verdict === "conflicted",
  );
  if (!claims.some((entry) => entry.assessment.verdict === "supported")) {
    return withCitationNotes(
      formatWithoutModel(plan, cited.executions, stopReason, verification, labels),
      {
        removedTokens,
        unverifiedTokens: 0,
      },
      labels,
    );
  }
  const fallback = withCitationNotes(
    formatWithoutModel(plan, input.executions, stopReason, verification, labels),
    { removedTokens, unverifiedTokens: 0 },
    labels,
  );
  if (!input.spendRound()) return fallback;
  const tokens = claims.flatMap((entry) => [
    ...entry.claim.citationTokens,
    ...entry.assessment.contradictingTokens,
  ]);
  try {
    const synthesized = await input.synthesis.synthesize({
      question: input.question,
      plan,
      claims,
      evidence: input.resolveEvidence?.([...new Set(tokens)]) ?? [],
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.onText ? { onText: input.onText } : {}),
    });
    const sections = verificationSections(plan, input.executions, verification, stopReason, labels);
    return withCitationNotes(
      `${synthesized.markdown}\n\n${sections}`,
      {
        removedTokens: synthesized.removedTokens + removedTokens,
        unverifiedTokens: synthesized.unverifiedTokens,
      },
      labels,
    );
  } catch (error) {
    if (input.signal?.aborted) throw error;
    return fallback;
  }
}

/** Prefixes the report with the required branches that are missing, when any is. */
export function withMissingNote(
  markdown: string,
  missing: readonly { branchId: string; reason: string }[],
  plan: ResearchPlan,
  labels: ResearchLabels,
): string {
  const titleOf = (branchId: string): string =>
    plan.branches.find((branch) => branch.branchId === branchId)?.title ?? branchId;
  const required = missing.filter(
    (entry) =>
      plan.branches.find((branch) => branch.branchId === entry.branchId)?.priority === "required",
  );
  if (required.length === 0) return markdown;
  const names = required.map((entry) => titleOf(entry.branchId));
  return `> ${label(labels, "partialReport", { branches: names.join(", ") })}\n\n${markdown}`;
}

/**
 * Keeps only the finding citations that resolve in the conversation source registry: unresolved
 * tokens leave the finding text and its listed sources and are counted.
 */
function registryCitedFindings(
  executions: readonly BranchExecution[],
  resolve: ReportWritingInput["resolveEvidence"],
): { executions: BranchExecution[]; removedTokens: number } {
  const stored = executions.flatMap((execution) => execution.finding?.citationTokens ?? []);
  const known = new Set((resolve?.(stored) ?? []).map((chunk) => chunk.id));
  let removedTokens = 0;
  const cited = executions.map((execution) => {
    const finding = execution.finding;
    if (!finding) return execution;
    const unknown = new Set(finding.citationTokens.filter((token) => !known.has(token)));
    removedTokens += unknown.size;
    return {
      ...execution,
      finding: {
        ...finding,
        text: removeUnknownCitationTokens(finding.text, known),
        citationTokens: finding.citationTokens.filter((token) => known.has(token)),
      },
    };
  });
  return { executions: cited, removedTokens };
}

function withCitationNotes(
  markdown: string,
  counts: { removedTokens: number; unverifiedTokens: number },
  labels: ResearchLabels,
): string {
  const notes = [
    counts.removedTokens > 0
      ? label(labels, "removedCitations", { count: counts.removedTokens })
      : "",
    counts.unverifiedTokens > 0
      ? label(labels, "unverifiedCitations", { count: counts.unverifiedTokens })
      : "",
  ].filter((note) => note !== "");
  return notes.length > 0 ? `${markdown}\n\n> ${notes.join(" ")}` : markdown;
}
