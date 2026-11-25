import type { ResearchHistoryEntry, ResearchReportSummary } from "./types";

export type ReportOutcome = "complete" | "partial" | "failed" | "cancelled";

export interface ReportShare {
  done: number;
  total: number;
}

export interface ReportClaims {
  supported: number;
  conflicted: number;
  unverified: number;
  total: number;
}

export interface ReportFacts {
  outcome: ReportOutcome;
  report: ResearchReportSummary | null;
  branches: ReportShare | null;
  claims: ReportClaims | null;
  objectives: ReportShare | null;
  uncovered: readonly string[];
}

/**
 * Reads what the final card of a research shows. A report is complete only when its quality is
 * complete, no branch is missing, no claim conflicts and every objective is covered; a research
 * without a report was cancelled or failed. Objective totals exist only for reports that recorded
 * their scale; reports without a covered count estimate it from the uncovered required ones.
 */
export function reportFacts(entry: ResearchHistoryEntry): ReportFacts {
  const report = entry.report;
  if (!report) {
    return {
      outcome: entry.phase === "cancelled" ? "cancelled" : "failed",
      report: null,
      branches: null,
      claims: null,
      objectives: null,
      uncovered: [],
    };
  }
  const counts = report.verification;
  const uncovered = counts?.uncoveredObjectives ?? [];
  const claims = counts && {
    supported: counts.supported,
    conflicted: counts.conflicted,
    unverified: counts.unsupported + counts.unresolved,
    total: counts.supported + counts.conflicted + counts.unsupported + counts.unresolved,
  };
  const clean =
    report.quality === "complete" &&
    report.missingBranches.length === 0 &&
    (claims?.conflicted ?? 0) === 0 &&
    uncovered.length === 0;
  const objectives = report.scale?.objectives;
  const covered = counts?.coveredObjectives ?? (objectives ?? 0) - uncovered.length;
  return {
    outcome: clean ? "complete" : "partial",
    report,
    branches: {
      done: report.completedBranches.length,
      total: report.completedBranches.length + report.missingBranches.length,
    },
    claims: claims && claims.total > 0 ? claims : null,
    objectives:
      objectives === undefined || objectives === 0
        ? null
        : { done: Math.min(objectives, Math.max(0, covered)), total: objectives },
    uncovered,
  };
}
