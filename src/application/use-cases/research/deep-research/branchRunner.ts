import type {
  BranchAllocation,
  BranchFinding,
  BranchUsage,
  ResearchWork,
} from "@core/research/deepResearch";

/**
 * Runs one attempt of a research work within its allocation. Implementations differ only in where
 * the attempt runs; a runner that measured its use reports it through `usage` after the attempt.
 */
export interface BranchRunner {
  readonly path: "main" | "sub-agent";
  run(
    work: ResearchWork,
    allocation: BranchAllocation,
    signal: AbortSignal,
  ): Promise<BranchFinding>;
  usage?(workId: string): BranchUsage | null;
}
