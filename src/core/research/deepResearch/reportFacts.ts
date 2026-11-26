import type { ResearchHistoryEntry, ResearchReportSummary } from "./types";

export type ReportOutcome = "complete" | "partial" | "failed" | "cancelled";

export interface ReportShare {
  done: number;
  total: number;
}

export type ReportWarning =
  | { kind: "summaryFailure"; reason: string }
  | { kind: "noDocuments" }
  | { kind: "uncitedBranches"; titles: readonly string[] }
  | { kind: "removedCitations"; count: number };

export interface ReportTime {
  minutes: number;
  limitMinutes: number;
}

export interface ReportFacts {
  outcome: ReportOutcome;
  report: ResearchReportSummary | null;
  branches: ReportShare | null;
  sources: ReportShare | null;
  time: ReportTime | null;
  warnings: readonly ReportWarning[];
}

const MINUTE_MS = 60_000;
const MAX_WARNINGS = 3;

/**
 * Reads what the final card of a research shows. A report is complete only when its quality is
 * complete and no branch is missing; a research without a report was cancelled or failed. Its
 * warnings name at most three weaknesses of the findings, the most serious first.
 */
export function reportFacts(entry: ResearchHistoryEntry): ReportFacts {
  const report = entry.report;
  if (!report) {
    return {
      outcome: entry.phase === "cancelled" ? "cancelled" : "failed",
      report: null,
      branches: null,
      sources: null,
      time: null,
      warnings: [],
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
    sources: report.stats
      ? { done: report.stats.sourcesCited, total: report.stats.sourcesFound }
      : null,
    time:
      report.scale && report.scale.activeLimitMs > 0
        ? {
            minutes: Math.floor(report.scale.activeMs / MINUTE_MS),
            limitMinutes: Math.floor(report.scale.activeLimitMs / MINUTE_MS),
          }
        : null,
    warnings: reportWarnings(report),
  };
}

function reportWarnings(report: ResearchReportSummary): ReportWarning[] {
  const { stats, summaryFailure } = report;
  const warnings: ReportWarning[] = [];
  if (summaryFailure !== undefined)
    warnings.push({ kind: "summaryFailure", reason: summaryFailure });
  if (stats && stats.documentsOpened === 0 && stats.sourcesFound > 0) {
    warnings.push({ kind: "noDocuments" });
  }
  if (stats && stats.uncitedBranches.length > 0) {
    warnings.push({
      kind: "uncitedBranches",
      titles: stats.uncitedBranches.map((branch) => branch.title),
    });
  }
  if (stats && stats.removedCitations > 0) {
    warnings.push({ kind: "removedCitations", count: stats.removedCitations });
  }
  return warnings.slice(0, MAX_WARNINGS);
}
