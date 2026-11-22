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
 * a runner that delegated it names the child run through `runRef`.
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
}
