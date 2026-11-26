import {
  blockDependants,
  boundedReason,
  branchPath,
  budgetLimits,
  DEFAULT_RESEARCH_LANGUAGE,
  ENGLISH_RESEARCH_LABELS,
  label,
  branchTaskText,
  nextReadyExecution,
  type BranchAllocation,
  type BranchExecution,
  type ResearchBudgetOwner,
  type ResearchPlan,
  type ResearchWork,
  type ResearchLabels,
} from "@core/research/deepResearch";
import {
  BranchNoFindingsError,
  BranchUnavailableError,
  UnusableBranchSessionError,
  type BranchRunner,
} from "./branchRunner";

export interface ResearchSchedulerRunners {
  main: BranchRunner;
  subAgent?: BranchRunner;
  sessionByBranch(): Readonly<Record<string, string>>;
}

export interface ResearchSchedulerDeps {
  language?: string;
  labels?: ResearchLabels;
  plan: ResearchPlan;
  executions: readonly BranchExecution[];
  owner: ResearchBudgetOwner;
  runners: ResearchSchedulerRunners;
  waveSize: number;
  signal: AbortSignal;
  setTimer(delayMs: number, callback: () => void): () => void;
  barrier(executions: readonly BranchExecution[]): Promise<void>;
  onStatus?(message: string): void;
}

interface Flight {
  work: ResearchWork;
  allocation: BranchAllocation;
  runner: BranchRunner;
  newSession: boolean;
  abandon(): void;
  done: Promise<FlightResult>;
}

interface FlightResult {
  flight: Flight;
  finding: BranchExecution["finding"];
  error: unknown;
  abandoned?: true;
}

export const STOP_SETTLE_MS = 10_000;

/**
 * Runs research works in waves in dependency and priority order: up to the wave size at once, at
 * most one of them on the main path, each in its branch's child session while the session ceiling
 * allows. Each attempt is admitted by the budget owner and committed as a wave barrier before it
 * starts and as a branch barrier when it settles; a user stop waits for the wave and leaves its open
 * allocations for the next turn to consume, while a budget closure settles them and ends the run.
 * An attempt that has not settled within the settle deadline after the abort is abandoned and
 * consumes its whole allocation.
 */
export class ResearchScheduler {
  private executions: BranchExecution[];
  private readonly flights = new Map<string, Flight>();
  private readonly mainOnly = new Set<string>();
  private readonly fallbacks: Flight[] = [];
  private cancelDeadline: (() => void) | null = null;
  private readonly onAbort = (): void => {
    this.cancelDeadline ??= this.deps.setTimer(STOP_SETTLE_MS, () => {
      for (const flight of this.flights.values()) flight.abandon();
    });
  };

  constructor(private readonly deps: ResearchSchedulerDeps) {
    this.executions = [...deps.executions];
    if (deps.signal.aborted) this.onAbort();
    else deps.signal.addEventListener("abort", this.onAbort, { once: true });
  }

  async run(works: readonly ResearchWork[]): Promise<readonly BranchExecution[]> {
    const { signal } = this.deps;
    const byId = new Map(works.map((work) => [work.workId, work]));
    let userStop: unknown = null;
    for (;;) {
      const blocked = blockDependants(this.executions, this.deps.plan, this.labels());
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
    for (const flight of this.fallbacks.splice(0)) {
      if (userStop !== null) continue;
      this.deps.owner.settle(flight.allocation, null);
      await this.update(flight.work.workId, { state: "pending" });
    }
    if (userStop !== null) {
      await this.commit(this.executions);
      throw userStop;
    }
    return this.executions;
  }

  /** Waits until every attempt still in flight has settled or was abandoned after the caller aborted the signal. */
  async drain(): Promise<void> {
    await Promise.all([...this.flights.values()].map((flight) => flight.done));
    this.cancelDeadline?.();
    this.deps.signal.removeEventListener("abort", this.onAbort);
  }

  private async launch(byId: ReadonlyMap<string, ResearchWork>): Promise<void> {
    const { plan, owner, runners } = this.deps;
    const fallback = this.fallbacks[0];
    if (fallback && !this.mainBusy() && this.flights.size < this.deps.waveSize) {
      this.fallbacks.shift();
      await this.start(fallback.work, fallback.allocation, runners.main);
    }
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
      const admitted = owner.allocate(
        work.workId,
        work.branchId,
        work.kind === "test" ? work.workId : work.branchId,
      );
      if (!admitted.ok) {
        if (admitted.dimension !== "branch-attempts") return;
        await this.update(
          next.workId,
          exhausted(
            plan,
            next,
            work.kind === "test"
              ? "No attempts remain for this test."
              : "No attempts remain for this branch.",
          ),
        );
        continue;
      }
      await this.start(work, admitted.allocation, runner);
    }
  }

  private async start(
    work: ResearchWork,
    allocation: BranchAllocation,
    runner: BranchRunner,
  ): Promise<void> {
    await this.update(work.workId, {
      state: "running",
      path: runner.path,
      attempts: allocation.attempt,
      terminalReason: null,
      runRef: undefined,
    });
    this.deps.onStatus?.(`Researching: ${titleOf(this.deps.plan, work.branchId)}`);
    const flight: Flight = {
      work,
      allocation,
      runner,
      newSession:
        runner.path === "sub-agent" &&
        this.deps.runners.sessionByBranch()[work.branchId] === undefined,
      abandon: () => undefined,
      done: null as unknown as Flight["done"],
    };
    const abandoned = new Promise<FlightResult>((resolve) => {
      flight.abandon = () =>
        resolve({ flight, finding: null, error: this.deps.signal.reason, abandoned: true });
    });
    const ran = runner
      .run(
        {
          ...work,
          task: branchTaskText(work.task, this.deps.language ?? DEFAULT_RESEARCH_LANGUAGE),
        },
        allocation,
        this.deps.signal,
      )
      .then(
        (finding): FlightResult => ({ flight, finding, error: null }),
        (error: unknown): FlightResult => ({
          flight,
          finding: null,
          error: error ?? new Error("failed"),
        }),
      );
    flight.done = Promise.race([ran, abandoned]);
    this.flights.set(work.workId, flight);
  }

  private mainBusy(): boolean {
    return [...this.flights.values()].some((flight) => flight.runner.path === "main");
  }

  /** Returns null when no runner may take the branch now: the main path is already busy. */
  private runnerFor(branchId: string): BranchRunner | null {
    const { runners } = this.deps;
    const inFlight = [...this.flights.values()];
    const path =
      this.mainOnly.has(branchId) || !runners.subAgent
        ? "main"
        : branchPath(
            runners.sessionByBranch(),
            branchId,
            inFlight.filter((flight) => flight.newSession).length,
            budgetLimits(this.deps.plan).childSessions,
          );
    if (path === "sub-agent") return runners.subAgent!;
    return this.mainBusy() || this.fallbacks.length > 0 ? null : runners.main;
  }

  /** Commits the branch barrier of one finished attempt; true when a user stop ended it. */
  private async settle(result: FlightResult): Promise<boolean> {
    const { owner, plan, signal } = this.deps;
    const { work, allocation, runner } = result.flight;
    if (result.abandoned) {
      owner.settle(allocation, null);
      await this.update(work.workId, {
        state: "pending",
        terminalReason: this.labels().attemptAbandoned,
      });
      return owner.snapshot().closed === null;
    }
    const runRef = runner.runRef?.(work.workId) ?? null;
    const ref = runRef ? { runRef } : {};
    if (result.error === null) {
      owner.settle(allocation, runner.usage?.(work.workId) ?? null);
      await this.update(work.workId, { state: "completed", finding: result.finding, ...ref });
      return false;
    }
    if (signal.aborted && owner.snapshot().closed === null) return true;
    if (result.error instanceof UnusableBranchSessionError && !signal.aborted) {
      this.mainOnly.add(work.branchId);
      this.fallbacks.push(result.flight);
      return false;
    }
    owner.settle(allocation, runner.usage?.(work.workId) ?? null);
    if (signal.aborted || owner.snapshot().closed) {
      await this.update(work.workId, { state: "pending", ...ref });
      return false;
    }
    const error = result.error;
    const labels = this.labels();
    const reason = boundedReason(attemptReason(error, labels));
    const retry =
      !(error instanceof BranchUnavailableError) &&
      allocation.attempt < plan.limits.attemptsPerBranch;
    const current = this.executions.find((entry) => entry.workId === work.workId)!;
    await this.update(work.workId, {
      ...(retry ? { state: "pending", terminalReason: reason } : exhausted(plan, current, reason)),
      ...ref,
    });
    return false;
  }

  private labels(): ResearchLabels {
    return this.deps.labels ?? ENGLISH_RESEARCH_LABELS;
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

function attemptReason(error: unknown, labels: ResearchLabels): string {
  if (error instanceof BranchUnavailableError) return labels.branchUnavailable;
  if (error instanceof BranchNoFindingsError) return labels.noFindings;
  if (error instanceof Error) return label(labels, "attemptFailed", { reason: error.message });
  return labels.attemptFailedPlain;
}
