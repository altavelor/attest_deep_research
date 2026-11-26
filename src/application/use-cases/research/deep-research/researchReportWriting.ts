import type { RetrievedChunk } from "@core/model";
import {
  boundedReason,
  contestedPoints,
  formatWithoutModel,
  label,
  type BranchExecution,
  type ResearchDiscovery,
  type ResearchLabels,
  type ResearchPlan,
} from "@core/research/deepResearch";
import type { ReportSynthesisService } from "./ReportSynthesisService";
import { removeUnknownCitationTokens } from "../strategies/citations";

export interface ReportWritingInput {
  question: string;
  plan: ResearchPlan;
  executions: readonly BranchExecution[];
  discovery: ResearchDiscovery | null;
  stopReason: string;
  labels: ResearchLabels;
  synthesis: ReportSynthesisService;
  spendRound(): boolean;
  now: Date;
  resolveEvidence?(revisionIds: readonly string[]): RetrievedChunk[];
  signal?: AbortSignal;
  onText?(markdown: string, thinking: number): void;
}

export interface WrittenReport {
  markdown: string;
  synthesized: boolean;
  summaryFailure?: string;
}

/**
 * Writes the report markdown. The model synthesizes it from the findings of every completed
 * branch and the contested points when a round remains; otherwise the findings are listed without
 * a model, and a failed synthesis returns its cause.
 */
export async function writeReportMarkdown(input: ReportWritingInput): Promise<WrittenReport> {
  const { plan, stopReason, labels } = input;
  const cited = registryCitedFindings(input.executions, input.resolveEvidence);
  const fallback = withCitationNotes(
    formatWithoutModel(plan, cited.executions, stopReason, labels),
    cited.removedTokens,
    labels,
  );
  const findings = cited.executions.flatMap((execution) =>
    execution.finding
      ? [
          {
            title:
              plan.branches.find((branch) => branch.branchId === execution.branchId)?.title ??
              execution.branchId,
            text: execution.finding.text.trim(),
            tokens: execution.finding.citationTokens,
          },
        ]
      : [],
  );
  if (findings.length === 0) return { markdown: fallback, synthesized: false };
  if (!input.spendRound()) {
    return {
      markdown: fallback,
      synthesized: false,
      summaryFailure: "No finalization round remained.",
    };
  }
  try {
    const synthesized = await input.synthesis.synthesize({
      question: input.question,
      now: input.now,
      plan,
      findings,
      contested: contestedPoints(input.discovery),
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.onText ? { onText: input.onText } : {}),
    });
    return {
      markdown: withCitationNotes(
        `${synthesized.markdown}\n\n${label(labels, "stopReasonLine", { reason: stopReason })}`,
        synthesized.removedTokens + cited.removedTokens,
        labels,
      ),
      synthesized: true,
    };
  } catch (error) {
    if (input.signal?.aborted) throw error;
    return {
      markdown: fallback,
      synthesized: false,
      summaryFailure: boundedReason(error instanceof Error ? error.message : "model error"),
    };
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
  removedTokens: number,
  labels: ResearchLabels,
): string {
  return removedTokens > 0
    ? `${markdown}\n\n> ${label(labels, "removedCitations", { count: removedTokens })}`
    : markdown;
}
