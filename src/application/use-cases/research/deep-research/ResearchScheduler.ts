import {
  blockDependants,
  boundedReason,
  nextReadyExecution,
  type BranchExecution,
  type ResearchBudgetOwner,
  type ResearchPlan,
  type ResearchWork,
} from "@core/research/deepResearch";
import type { BranchRunner } from "./branchRunner";

export interface ResearchSchedulerDeps {
  plan: ResearchPlan;
  executions: readonly BranchExecution[];
  owner: ResearchBudgetOwner;
  runner: BranchRunner;
  signal: AbortSignal;
  barrier(executions: readonly BranchExecution[]): Promise<void>;
  onStatus?(message: string): void;
}

/**
 * Runs research works one at a time in dependency and priority order. Each attempt is admitted by
 * the budget owner and committed as a wave barrier before it starts and as a branch barrier when it
 * settles; a failed attempt retries while attempts remain and a user stop leaves the open allocation
 * for the next turn to consume.
 */
export class ResearchScheduler {
  private executions: BranchExecution[];

  constructor(private readonly deps: ResearchSchedulerDeps) {
    this.executions = [...deps.executions];
  }

  async run(works: readonly ResearchWork[]): Promise<readonly BranchExecution[]> {
    const { plan, owner, runner, signal } = this.deps;
    const byId = new Map(works.map((work) => [work.workId, work]));
    for (;;) {
      const blocked = blockDependants(this.executions, plan);
      if (blocked.some((entry, index) => entry !== this.executions[index])) {
        await this.commit(blocked);
      }
      const next = nextReadyExecution(
        this.executions.filter((entry) => entry.state !== "pending" || byId.has(entry.workId)),
        plan,
      );
      if (!next || signal.aborted) return this.executions;
      const work = byId.get(next.workId)!;
      const admitted = owner.allocate(work.workId, work.branchId);
      if (!admitted.ok) {
        if (admitted.dimension !== "branch-attempts") return this.executions;
        await this.update(next, exhausted(plan, next, "No attempts remain for this branch."));
        continue;
      }
      const { allocation } = admitted;
      await this.update(next, {
        state: "running",
        path: runner.path,
        attempts: allocation.attempt,
        terminalReason: null,
      });
      this.deps.onStatus?.(`Researching: ${titleOf(plan, work.branchId)}`);
      try {
        const finding = await runner.run(work, allocation, signal);
        owner.settle(allocation, runner.usage?.(work.workId) ?? null);
        await this.update(next, { state: "completed", finding });
      } catch (error) {
        if (signal.aborted && owner.snapshot().closed?.reason !== "time") throw error;
        owner.settle(allocation, runner.usage?.(work.workId) ?? null);
        if (signal.aborted) {
          await this.update(next, { state: "pending" });
          return this.executions;
        }
        const reason = boundedReason(
          error instanceof Error ? error.message : "The attempt failed.",
        );
        const retry = allocation.attempt < plan.limits.attemptsPerBranch;
        await this.update(
          next,
          retry ? { state: "pending", terminalReason: reason } : exhausted(plan, next, reason),
        );
      }
    }
  }

  private async update(target: BranchExecution, patch: Partial<BranchExecution>): Promise<void> {
    await this.commit(
      this.executions.map((entry) =>
        entry.workId === target.workId ? { ...entry, ...patch } : entry,
      ),
    );
  }

  private async commit(executions: BranchExecution[]): Promise<void> {
    await this.deps.barrier(executions);
    this.executions = executions;
  }
}

function exhausted(
  plan: ResearchPlan,
  execution: BranchExecution,
  reason: string,
): Partial<BranchExecution> {
  const optional =
    plan.branches.find((branch) => branch.branchId === execution.branchId)?.priority === "optional";
  return { state: optional ? "skipped" : "failed", terminalReason: reason };
}

function titleOf(plan: ResearchPlan, branchId: string): string {
  return plan.branches.find((branch) => branch.branchId === branchId)?.title ?? branchId;
}
