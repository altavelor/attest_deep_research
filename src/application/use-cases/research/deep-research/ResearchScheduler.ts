import {
  blockDependants,
  boundedReason,
  branchPath,
  nextReadyExecution,
  type BranchAllocation,
  type BranchExecution,
  type ResearchBudgetOwner,
  type ResearchPlan,
  type ResearchWork,
} from "@core/research/deepResearch";
import type { BranchRunner } from "./branchRunner";

export interface ResearchSchedulerRunners {
  main: BranchRunner;
  subAgent?: BranchRunner;
  sessionByBranch(): Readonly<Record<string, string>>;
}

export interface ResearchSchedulerDeps {
  plan: ResearchPlan;
  executions: readonly BranchExecution[];
  owner: ResearchBudgetOwner;
  runners: ResearchSchedulerRunners;
  waveSize: number;
  signal: AbortSignal;
  barrier(executions: readonly BranchExecution[]): Promise<void>;
  onStatus?(message: string): void;
}

interface Flight {
  work: ResearchWork;
  allocation: BranchAllocation;
  runner: BranchRunner;
  newSession: boolean;
  done: Promise<{ flight: Flight; finding: BranchExecution["finding"]; error: unknown }>;
}

/**
 * Runs research works in waves in dependency and priority order: up to the wave size at once, at
 * most one of them on the main path, each in its branch's child session while the session ceiling
 * allows. Each attempt is admitted by the budget owner and committed as a wave barrier before it
 * starts and as a branch barrier when it settles; a user stop waits for the wave and leaves its open
 * allocations for the next turn to consume, while a budget closure settles them and ends the run.
 */
export class ResearchScheduler {
  private executions: BranchExecution[];
  private readonly flights = new Map<string, Flight>();

  constructor(private readonly deps: ResearchSchedulerDeps) {
    this.executions = [...deps.executions];
  }

  async run(works: readonly ResearchWork[]): Promise<readonly BranchExecution[]> {
    const { signal } = this.deps;
    const byId = new Map(works.map((work) => [work.workId, work]));
    let userStop: unknown = null;
    for (;;) {
      const blocked = blockDependants(this.executions, this.deps.plan);
      if (blocked.some((entry, index) => entry !== this.executions[index])) {
        await this.commit(blocked);
      }
      if (!signal.aborted) await this.launch(byId);
      if (this.flights.size === 0) break;
      const settled = await Promise.race([...this.flights.values()].map((flight) => flight.done));
      this.flights.delete(settled.flight.work.workId);
      const stopped = await this.settle(settled);
      if (stopped && userStop === null) userStop = settled.error;
    }
    if (userStop !== null) {
      await this.commit(this.executions);
      throw userStop;
    }
    return this.executions;
  }

  private async launch(byId: ReadonlyMap<string, ResearchWork>): Promise<void> {
    const { plan, owner, runners } = this.deps;
    while (this.flights.size < this.deps.waveSize) {
      const next = nextReadyExecution(
        this.executions.filter(
          (entry) =>
            entry.state !== "pending" ||
            (byId.has(entry.workId) && !this.flights.has(entry.workId)),
        ),
        plan,
      );
      if (!next) return;
      const runner = this.runnerFor(next.branchId);
      if (!runner) return;
      const work = byId.get(next.workId)!;
      const admitted = owner.allocate(work.workId, work.branchId);
      if (!admitted.ok) {
        if (admitted.dimension !== "branch-attempts") return;
        await this.update(
          next.workId,
          exhausted(plan, next, "No attempts remain for this branch."),
        );
        continue;
      }
      const { allocation } = admitted;
      await this.update(next.workId, {
        state: "running",
        path: runner.path,
        attempts: allocation.attempt,
        terminalReason: null,
        runRef: undefined,
      });
      this.deps.onStatus?.(`Researching: ${titleOf(plan, work.branchId)}`);
      const flight: Flight = {
        work,
        allocation,
        runner,
        newSession:
          runner.path === "sub-agent" && runners.sessionByBranch()[work.branchId] === undefined,
        done: null as unknown as Flight["done"],
      };
      flight.done = runner.run(work, allocation, this.deps.signal).then(
        (finding) => ({ flight, finding, error: null }),
        (error: unknown) => ({ flight, finding: null, error: error ?? new Error("failed") }),
      );
      this.flights.set(work.workId, flight);
    }
  }

  /** Returns null when no runner may take the branch now: the main path is already busy. */
  private runnerFor(branchId: string): BranchRunner | null {
    const { runners } = this.deps;
    const inFlight = [...this.flights.values()];
    const path = runners.subAgent
      ? branchPath(
          runners.sessionByBranch(),
          branchId,
          inFlight.filter((flight) => flight.newSession).length,
          this.deps.plan.limits.childSessions,
        )
      : "main";
    if (path === "sub-agent") return runners.subAgent!;
    return inFlight.some((flight) => flight.runner.path === "main") ? null : runners.main;
  }

  /** Commits the branch barrier of one finished attempt; true when a user stop ended it. */
  private async settle(result: Awaited<Flight["done"]>): Promise<boolean> {
    const { owner, plan, signal } = this.deps;
    const { work, allocation, runner } = result.flight;
    const runRef = runner.runRef?.(work.workId) ?? null;
    const ref = runRef ? { runRef } : {};
    if (result.error === null) {
      owner.settle(allocation, runner.usage?.(work.workId) ?? null);
      await this.update(work.workId, { state: "completed", finding: result.finding, ...ref });
      return false;
    }
    if (signal.aborted && owner.snapshot().closed === null) return true;
    owner.settle(allocation, runner.usage?.(work.workId) ?? null);
    if (signal.aborted || owner.snapshot().closed) {
      await this.update(work.workId, { state: "pending", ...ref });
      return false;
    }
    const error = result.error;
    const reason = boundedReason(error instanceof Error ? error.message : "The attempt failed.");
    const retry = allocation.attempt < plan.limits.attemptsPerBranch;
    const current = this.executions.find((entry) => entry.workId === work.workId)!;
    await this.update(work.workId, {
      ...(retry ? { state: "pending", terminalReason: reason } : exhausted(plan, current, reason)),
      ...ref,
    });
    return false;
  }

  private async update(workId: string, patch: Partial<BranchExecution>): Promise<void> {
    await this.commit(
      this.executions.map((entry) => (entry.workId === workId ? { ...entry, ...patch } : entry)),
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
