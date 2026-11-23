import type {
  BranchAllocation,
  BranchFinding,
  BranchRunRef,
  BranchUsage,
  ResearchWork,
} from "@core/research/deepResearch";

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

/** The branch's mapped child session refused the attempt before it started; the main path takes it. */
export class UnusableBranchSessionError extends Error {
  constructor(readonly sessionId: string) {
    super("The branch session can no longer be continued.");
    this.name = "UnusableBranchSessionError";
  }
}
