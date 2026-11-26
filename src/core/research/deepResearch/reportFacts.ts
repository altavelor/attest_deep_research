import type { ResearchHistoryEntry, ResearchReportSummary } from "./types";

export type ReportOutcome = "complete" | "partial" | "failed" | "cancelled";

export interface ReportShare {
  done: number;
  total: number;
}

export interface ReportFacts {
  outcome: ReportOutcome;
  report: ResearchReportSummary | null;
  branches: ReportShare | null;
}

/**
 * Reads what the final card of a research shows. A report is complete only when its quality is
 * complete and no branch is missing; a research without a report was cancelled or failed.
 */
export function reportFacts(entry: ResearchHistoryEntry): ReportFacts {
  const report = entry.report;
  if (!report) {
    return {
      outcome: entry.phase === "cancelled" ? "cancelled" : "failed",
      report: null,
      branches: null,
    };
  }
  return {
    outcome:
      report.quality === "complete" && report.missingBranches.length === 0 ? "complete" : "partial",
    report,
    branches: {
      done: report.completedBranches.length,
      total: report.completedBranches.length + report.missingBranches.length,
    },
  };
}
