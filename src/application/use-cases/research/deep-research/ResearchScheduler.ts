import {
  blockDependants,
  boundedReason,
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
  releaseSession?(branchId: string): void;
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
  abandon(): void;
  done: Promise<FlightResult>;
}

interface Admission {
  work: ResearchWork;
  allocation: BranchAllocation;
  runner: BranchRunner;
}

interface FlightResult {
  flight: Flight;
  finding: BranchExecution["finding"];
  error: unknown;
  abandoned?: true;
}

export const STOP_SETTLE_MS = 10_000;

/**
 * Runs research works in waves in dependency and priority order. With a sub-agent runner every
 * work runs in its branch's child session, a free slot is filled in one step and the works beyond
 * the wave size wait for a slot; without one the works run one at a time on the main path. Each
 * attempt is admitted by the budget owner and committed as a wave barrier before it starts and as a
 * branch barrier when it settles; a user stop waits for the wave and leaves its open allocations for
 * the next turn to consume, while a budget closure settles them and ends the run. An attempt that
 * has not settled within the settle deadline after the abort is abandoned and consumes its whole
 * allocation.
 */
export class ResearchScheduler {
  private executions: BranchExecution[];
  private readonly flights = new Map<string, Flight>();
  private readonly renewed = new Set<string>();
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
    const { plan, owner } = this.deps;
    const admitted: Admission[] = [];
    const claimed = new Set<string>();
    while (this.flights.size + admitted.length < this.deps.waveSize) {
      const next = nextReadyExecution(
        this.executions.filter(
          (entry) =>
            entry.state !== "pending" ||
            (byId.has(entry.workId) &&
              !this.flights.has(entry.workId) &&
              !claimed.has(entry.workId)),
        ),
        plan,
      );
      if (!next) break;
      const runner = this.runnerFor(admitted);
      if (!runner) break;
      const work = byId.get(next.workId)!;
      const granted = owner.allocate(
        work.workId,
        work.branchId,
        work.kind === "test" ? work.workId : work.branchId,
      );
      if (!granted.ok) {
        if (granted.dimension !== "branch-attempts") break;
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
      claimed.add(work.workId);
      admitted.push({ work, allocation: granted.allocation, runner });
    }
    await this.start(admitted);
  }

  private async start(admitted: readonly Admission[]): Promise<void> {
    if (admitted.length === 0) return;
    await this.commit(
      this.executions.map((entry) => {
        const own = admitted.find((item) => item.work.workId === entry.workId);
        return own
          ? {
              ...entry,
              state: "running",
              path: own.runner.path,
              attempts: own.allocation.attempt,
              terminalReason: null,
              runRef: undefined,
            }
          : entry;
      }),
    );
    for (const { work, allocation, runner } of admitted) {
      this.deps.onStatus?.(`Researching: ${titleOf(this.deps.plan, work.branchId)}`);
      const flight: Flight = {
        work,
        allocation,
        runner,
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
  }

  /** Returns the runner for the next work, or null when none may take it now. */
  private runnerFor(admitted: readonly Admission[]): BranchRunner | null {
    const { runners } = this.deps;
    if (runners.subAgent) return runners.subAgent;
    const mainBusy =
      admitted.length > 0 ||
      [...this.flights.values()].some((flight) => flight.runner.path === "main");
    return mainBusy ? null : runners.main;
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
    const renewKey = `${work.workId}#${allocation.attempt}`;
    if (
      result.error instanceof UnusableBranchSessionError &&
      !signal.aborted &&
      this.deps.runners.releaseSession &&
      !this.renewed.has(renewKey)
    ) {
      this.renewed.add(renewKey);
      this.deps.runners.releaseSession(work.branchId);
      await this.start([{ work, allocation, runner }]);
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
