import { MAX_RESEARCH_BRANCHES, MAX_RESEARCH_TEXT_CHARS } from "./limits";
import { isResearchId, isRevision } from "./planValidation";
import type { ResearchReportStats } from "./types";

/**
 * Reads the optional stats of a report summary: undefined when absent, null when malformed. A
 * report written before the stats existed has none.
 */
export function readReportStats(value: unknown): ResearchReportStats | null | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "object" ||
    value === null ||
    !isRevision((value as ResearchReportStats).sourcesFound) ||
    !isRevision((value as ResearchReportStats).sourcesCited) ||
    (value as ResearchReportStats).sourcesCited > (value as ResearchReportStats).sourcesFound ||
    !isRevision((value as ResearchReportStats).documentsOpened) ||
    !isRevision((value as ResearchReportStats).removedCitations) ||
    !isBranchTitles((value as ResearchReportStats).uncitedBranches)
  ) {
    return null;
  }
  const stats = value as ResearchReportStats;
  return {
    sourcesFound: stats.sourcesFound,
    sourcesCited: stats.sourcesCited,
    documentsOpened: stats.documentsOpened,
    removedCitations: stats.removedCitations,
    uncitedBranches: stats.uncitedBranches.map(({ branchId, title }) => ({ branchId, title })),
  };
}

function isBranchTitles(value: unknown): value is ResearchReportStats["uncitedBranches"] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_RESEARCH_BRANCHES &&
    value.every(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        isResearchId(entry.branchId) &&
        typeof entry.title === "string" &&
        entry.title.length > 0 &&
        entry.title.length <= MAX_RESEARCH_TEXT_CHARS,
    )
  );
}
