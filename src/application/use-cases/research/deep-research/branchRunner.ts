import { isDocumentReadTool } from "@core/research";
import { MAX_UNREAD_SOURCE_CHARS, MAX_UNREAD_SOURCES } from "@core/research/deepResearch";
import type {
  BranchAllocation,
  BranchFinding,
  BranchRunRef,
  BranchUsage,
  ResearchWork,
} from "@core/research/deepResearch";
import type { ResearchEvidenceSnapshot } from "@application/sources";

export const RESEARCH_BRANCH_MAX_RESULT_CHARS = 120_000;

/**
 * Runs one attempt of a research work within its allocation. Implementations differ only in where
 * the attempt runs; a runner that measured its use reports it through `usage` after the attempt, and
 * a runner that delegated it names the child run through `runRef` and its outcome through `childRun`.
 */
export interface BranchRunner {
  readonly path: "main" | "sub-agent";
  run(
    work: ResearchWork,
    allocation: BranchAllocation,
    signal: AbortSignal,
  ): Promise<BranchFinding>;
  usage?(workId: string): BranchUsage | null;
  runRef?(workId: string): BranchRunRef | null;
  childRun?(workId: string): BranchChildRun | null;
}

export interface BranchChildRun {
  outcome: string;
  evidenceCount: number;
}

/** A branch attempt that cannot succeed on retry, such as a branch sharing no source with the chat. */
export class BranchUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BranchUnavailableError";
  }
}

/** Signals that a branch attempt ended without any finding text. */
export class BranchNoFindingsError extends Error {
  constructor() {
    super("The branch produced no findings.");
    this.name = "BranchNoFindingsError";
  }
}

/** The branch's mapped child session refused the attempt before it started; the main path takes it. */
export class UnusableBranchSessionError extends Error {
  constructor(readonly sessionId: string) {
    super("The branch session can no longer be continued.");
    this.name = "UnusableBranchSessionError";
  }
}

/** Counts the evidence items of a snapshot whose content a branch opened rather than found in a search hit. */
export function openedDocuments(snapshot: ResearchEvidenceSnapshot): number {
  return snapshot.provenance.filter((entry) =>
    entry.calls.some((call) => isDocumentReadTool(call.tool)),
  ).length;
}

/**
 * Lists the web pages a branch found in search hits and never opened, those its finding cites
 * first, as the gaps a later check of the branch should close. The list is bounded and has no repeats.
 */
export function unreadWebSources(
  snapshot: ResearchEvidenceSnapshot,
  citedEvidenceIds: ReadonlySet<string>,
): string[] {
  const opened = new Set(
    snapshot.provenance
      .filter((entry) => entry.calls.some((call) => isDocumentReadTool(call.tool)))
      .map((entry) => entry.evidenceId),
  );
  const unread = snapshot.evidence.filter(
    (chunk) => chunk.source.kind === "web" && !opened.has(chunk.id),
  );
  const ordered = [
    ...unread.filter((chunk) => citedEvidenceIds.has(chunk.id)),
    ...unread.filter((chunk) => !citedEvidenceIds.has(chunk.id)),
  ];
  const urls = ordered.map((chunk) => (chunk.source.kind === "web" ? chunk.source.url : ""));
  return [...new Set(urls)]
    .filter((url) => url !== "" && url.length <= MAX_UNREAD_SOURCE_CHARS)
    .slice(0, MAX_UNREAD_SOURCES);
}
