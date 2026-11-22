import type {
  BranchAllocation,
  BudgetDimension,
  ResearchBudgetState,
  ResearchLimits,
} from "./types";

export interface BranchUsage {
  modelRounds: number;
  searches: number;
  evidenceItems: number;
  inputTokens?: number;
  outputTokens?: number;
  fetches?: number;
}

export type AllocationResult =
  | { ok: true; allocation: BranchAllocation }
  | { ok: false; dimension: BudgetDimension | "branch-attempts" | "closed" };

/** Returns the budget snapshot of a research that has not spent anything yet. */
export function emptyBudgetState(): ResearchBudgetState {
  return {
    consumed: { branchAttempts: 0, modelRounds: 0, searches: 0, evidenceItems: 0 },
    attemptsByBranch: {},
    activeMs: 0,
    openAllocations: [],
    closed: null,
    diagnostics: { inputTokens: null, outputTokens: null, fetches: 0 },
  };
}

/**
 * The in-memory budget of one research turn and its only admission authority. It opens from the
 * stored snapshot, consumes in full every allocation a dead turn left open, grants attempts within
 * the caps outside the finalization reserve, settles actual use, and counts active time only
 * between `open` and the latest snapshot.
 */
export class ResearchBudgetOwner {
  private state: ResearchBudgetState = emptyBudgetState();
  private openedAtMs = 0;

  constructor(
    private readonly limits: ResearchLimits,
    private readonly nowMs: () => number,
  ) {}

  /** Opens the turn's budget from a snapshot and returns the allocations of a dead turn it consumed. */
  open(snapshot: ResearchBudgetState | null): readonly BranchAllocation[] {
    const base = snapshot ?? emptyBudgetState();
    let consumed = { ...base.consumed };
    for (const allocation of base.openAllocations) {
      consumed = addUse(consumed, allocation.modelRounds, allocation.searches, 0);
    }
    this.state = { ...base, consumed, openAllocations: [] };
    this.openedAtMs = this.nowMs();
    return base.openAllocations;
  }

  /** Grants one attempt of a branch work or names the dimension that denies it. */
  allocate(workId: string, branchId: string): AllocationResult {
    const { consumed, attemptsByBranch, openAllocations } = this.state;
    if (this.state.closed || this.remainingMs() <= 0) return { ok: false, dimension: "closed" };
    if ((attemptsByBranch[branchId] ?? 0) >= this.limits.attemptsPerBranch) {
      return { ok: false, dimension: "branch-attempts" };
    }
    const openRounds = sum(openAllocations, "modelRounds");
    const rounds =
      this.limits.modelRoundsTotal -
      this.limits.finalizationReserveRounds -
      consumed.modelRounds -
      openRounds;
    const searches =
      this.limits.searchesTotal - consumed.searches - sum(openAllocations, "searches");
    const denied: BudgetDimension | null =
      consumed.branchAttempts >= this.limits.attemptsTotal
        ? "branchAttempts"
        : rounds < 1
          ? "modelRounds"
          : searches < 1
            ? "searches"
            : consumed.evidenceItems >= this.limits.evidenceItemsTotal
              ? "evidenceItems"
              : null;
    if (denied) {
      this.close("exhausted", denied);
      return { ok: false, dimension: denied };
    }
    const attempt = (attemptsByBranch[branchId] ?? 0) + 1;
    const allocation: BranchAllocation = {
      workId,
      branchId,
      attempt,
      modelRounds: Math.min(this.limits.modelRoundsPerAttempt, rounds),
      searches: Math.min(Math.ceil(this.limits.searchesTotal / this.limits.branches), searches),
    };
    this.state = {
      ...this.state,
      consumed: { ...consumed, branchAttempts: consumed.branchAttempts + 1 },
      attemptsByBranch: { ...attemptsByBranch, [branchId]: attempt },
      openAllocations: [...openAllocations, allocation],
    };
    return { ok: true, allocation };
  }

  /** Replaces an open allocation with the use the runner reported, or with the full allocation. */
  settle(allocation: BranchAllocation, usage: BranchUsage | null): void {
    const rounds = usage
      ? Math.min(usage.modelRounds, allocation.modelRounds)
      : allocation.modelRounds;
    const searches = usage ? Math.min(usage.searches, allocation.searches) : allocation.searches;
    const diagnostics = this.state.diagnostics;
    this.state = {
      ...this.state,
      consumed: addUse(this.state.consumed, rounds, searches, usage?.evidenceItems ?? 0),
      openAllocations: this.state.openAllocations.filter(
        (entry) => entry.workId !== allocation.workId || entry.attempt !== allocation.attempt,
      ),
      diagnostics: {
        inputTokens: addOptional(diagnostics.inputTokens, usage?.inputTokens),
        outputTokens: addOptional(diagnostics.outputTokens, usage?.outputTokens),
        fetches: diagnostics.fetches + (usage?.fetches ?? 0),
      },
    };
  }

  /** Spends finalization rounds for verification or synthesis; false when none remain. */
  spendFinalization(rounds: number): boolean {
    if (this.state.closed?.reason === "time" || this.remainingMs() <= 0) return false;
    const remaining = this.limits.modelRoundsTotal - this.state.consumed.modelRounds;
    if (remaining < rounds) return false;
    this.state = { ...this.state, consumed: addUse(this.state.consumed, rounds, 0, 0) };
    return true;
  }

  /** Closes the budget for the rest of the research; the first reason is kept. */
  close(reason: "exhausted" | "time" | "user", dimension: string | null = null): void {
    if (this.state.closed) return;
    this.state = { ...this.state, closed: { reason, dimension } };
  }

  /** Returns the active execution time left before the time limit. */
  remainingMs(): number {
    return this.limits.activeExecutionMs - this.activeMs();
  }

  /** Returns the snapshot to store at a barrier, with active time counted up to now. */
  snapshot(): ResearchBudgetState {
    return { ...this.state, activeMs: this.activeMs() };
  }

  private activeMs(): number {
    return this.state.activeMs + Math.max(0, this.nowMs() - this.openedAtMs);
  }
}

function addUse(
  consumed: Readonly<Record<BudgetDimension, number>>,
  rounds: number,
  searches: number,
  evidenceItems: number,
): Record<BudgetDimension, number> {
  return {
    ...consumed,
    modelRounds: consumed.modelRounds + rounds,
    searches: consumed.searches + searches,
    evidenceItems: consumed.evidenceItems + evidenceItems,
  };
}

function sum(allocations: readonly BranchAllocation[], key: "modelRounds" | "searches"): number {
  return allocations.reduce((total, allocation) => total + allocation[key], 0);
}

function addOptional(total: number | null, value: number | undefined): number | null {
  return value === undefined ? total : (total ?? 0) + value;
}
