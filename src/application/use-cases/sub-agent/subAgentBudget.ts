import type {
  SubAgentBudgetPermit,
  SubAgentBudgetPermitPort,
  SubAgentBudgetRegistration,
  SubAgentBudgetRegistrationFinishResult,
  SubAgentBudgetRegistrationResult,
  SubAgentBudgetRequest,
  SubAgentBudgetReserveResult,
  SubAgentBudgetUnit,
  SubAgentSessionManagerContext,
} from "@application/ports/subAgent";
import type {
  SubAgentBudgetPolicy,
  SubAgentPendingAction,
  SubAgentPendingActionState,
  ValidatedJsonValue,
} from "@core/research";
import type { ParentFences } from "./parentFences";
import { sessionFailure, type SubAgentStateStore } from "./SubAgentStateStore";

const BUDGET_UNITS: readonly string[] = [
  "branchAttempts",
  "modelRounds",
  "searches",
  "fetches",
  "evidenceItems",
  "verificationFollowUps",
  "inputTokens",
  "outputTokens",
] satisfies readonly SubAgentBudgetUnit[];

export interface SubAgentBudgetIdentity {
  sessionId: string;
  runId: string;
  attempt: number;
  scopeId: string;
}

export interface SubAgentBudgetGrant {
  permit: SubAgentBudgetPermit;
  action: SubAgentPendingAction;
}

export type SubAgentRefusalReason = "budget-denied" | "work-budget-denied" | "budget-port-error";

export type SubAgentBudgetAdmission =
  | { type: "granted"; grant: SubAgentBudgetGrant }
  | { type: "refused"; reason: SubAgentRefusalReason; closureId: string | null }
  | { type: "stale" };

export type SubAgentMeteredAction = Pick<SubAgentBudgetRequest, "action" | "units">;

interface CoordinatorParts {
  context: Pick<SubAgentSessionManagerContext, "budget">;
  store: SubAgentStateStore;
  fences: ParentFences;
}

interface Tracked {
  sessionId: string;
}

/** Returns the scope of a required-scope policy, or null for a local policy. */
export function scopeOf(policy: SubAgentBudgetPolicy): string | null {
  return policy.type === "required-scope" ? policy.scopeId : null;
}

/** Throws invalid-input unless every unit is known and a finite non-negative number. */
export function assertBudgetUnits(units: unknown): void {
  if (typeof units !== "object" || units === null || Array.isArray(units)) {
    throw sessionFailure("invalid-input");
  }
  for (const [unit, amount] of Object.entries(units)) {
    if (
      !BUDGET_UNITS.includes(unit) ||
      typeof amount !== "number" ||
      !Number.isFinite(amount) ||
      amount < 0
    ) {
      throw sessionFailure("invalid-input");
    }
  }
}

/**
 * Runs the required-scope budget protocol of one chat manager against the scope owner's
 * permit port. Each step persists the pending action identity first, awaits the port
 * without holding any manager state, then compares the whole identity and fence before
 * a side effect; a stale or late grant is settled as not-started and never resumes work.
 */
export class SubAgentBudgetCoordinator {
  private readonly fenceGenerations = new Map<string, number>();
  private readonly unsettled = new Map<string, Tracked>();

  constructor(private readonly parts: CoordinatorParts) {}

  fence(sessionId: string): void {
    this.fenceGenerations.set(sessionId, this.generation(sessionId) + 1);
  }

  unsettledKeys(sessionIds: ReadonlySet<string>): string[] {
    return [...this.unsettled]
      .filter(([, entry]) => sessionIds.has(entry.sessionId))
      .map(([key]) => key);
  }

  async register(scopeId: string, creationKey: string): Promise<SubAgentBudgetRegistrationResult> {
    const port = this.port();
    try {
      return await port.beginSessionRegistration(scopeId, creationKey);
    } catch {
      throw sessionFailure("budget-port-error");
    }
  }

  async finishRegistration(
    registration: SubAgentBudgetRegistration,
    outcome: { type: "published"; sessionId: string } | { type: "aborted" },
  ): Promise<SubAgentBudgetRegistrationFinishResult> {
    const port = this.port();
    try {
      return await port.finishSessionRegistration(registration, outcome);
    } catch {
      throw sessionFailure("budget-port-error");
    }
  }

  async admitExecution(
    identity: SubAgentBudgetIdentity,
    isCurrent: () => boolean,
  ): Promise<SubAgentBudgetAdmission> {
    const port = this.port();
    const action = await this.prepare(identity, "execution", 0);
    const request = (): Promise<SubAgentBudgetReserveResult> =>
      port.beginExecution(identity.scopeId, action.actionKey);
    return this.resolve(action, await this.call(action, request), isCurrent, request);
  }

  /**
   * Reserves one metered action, marks it started and runs the side effect without an
   * await in between; the permit is settled consumed once the side effect has been tried.
   */
  async meter<T>(
    identity: SubAgentBudgetIdentity,
    metered: SubAgentMeteredAction,
    isCurrent: () => boolean,
    sideEffect: () => Promise<T>,
  ): Promise<T> {
    assertBudgetUnits(metered.units);
    const port = this.port();
    const action = await this.prepare(
      identity,
      metered.action,
      this.nextOrdinal(identity, metered),
    );
    const request = (): Promise<SubAgentBudgetReserveResult> =>
      port.reserve(identity.scopeId, { actionKey: action.actionKey, ...metered });
    const admission = this.resolve(action, await this.call(action, request), isCurrent, request);
    if (admission.type === "stale") throw sessionFailure("fenced-delivery");
    if (admission.type === "refused") {
      throw sessionFailure(
        admission.reason === "budget-port-error" ? "budget-port-error" : "budget-denied",
        admission.closureId === null ? undefined : { closureId: admission.closureId },
      );
    }
    const started = await this.start(admission.grant, isCurrent);
    if (started !== "started") {
      throw sessionFailure(started === "stale" ? "fenced-delivery" : "budget-port-error");
    }
    try {
      return await sideEffect();
    } finally {
      void this.settle(admission.grant, "consumed");
    }
  }

  /** Durably marks the permit started; an unknown start outcome or a lost fence consumes it. */
  async start(
    grant: SubAgentBudgetGrant,
    isCurrent: () => boolean,
  ): Promise<"started" | "stale" | "failed"> {
    try {
      await this.port().markStarted(grant.permit);
    } catch {
      this.stage(grant.action, "unknown");
      void this.settle(grant, "consumed");
      return "failed";
    }
    if (!this.isCurrent(grant.action, isCurrent)) {
      void this.settle(grant, "consumed");
      return "stale";
    }
    this.stage(grant.action, "started");
    return "started";
  }

  /** Settles a permit once; a port failure leaves it unsettled and its key unresolved. */
  async settle(grant: SubAgentBudgetGrant, outcome: "consumed" | "not-started"): Promise<void> {
    try {
      await this.port().settle(grant.permit, outcome);
    } catch {
      return;
    }
    this.unsettled.delete(grant.action.actionKey);
    this.stage(grant.action, "settled", { settlement: outcome });
  }

  /** Claims the cleanup of a closed scope; a disposed manager neither claims nor cleans up. */
  async claimCleanup(scopeId: string, closureId: string): Promise<boolean> {
    if (this.disposed) return false;
    try {
      return (await this.port().claimClosureCleanup(scopeId, closureId)) && !this.disposed;
    } catch {
      return false;
    }
  }

  private get disposed(): boolean {
    return this.parts.fences.disposed;
  }

  private port(): SubAgentBudgetPermitPort {
    const port = this.parts.context.budget;
    if (!port) throw sessionFailure("not-authorized");
    return port;
  }

  private generation(sessionId: string): number {
    return this.fenceGenerations.get(sessionId) ?? 0;
  }

  private isCurrent(action: SubAgentPendingAction, isCurrent: () => boolean): boolean {
    return (
      !this.disposed && this.generation(action.sessionId) === action.fenceGeneration && isCurrent()
    );
  }

  private nextOrdinal(identity: SubAgentBudgetIdentity, metered: SubAgentMeteredAction): number {
    const ordinals = (this.parts.store.state?.pendingActions ?? [])
      .filter(
        (entry) =>
          entry.sessionId === identity.sessionId &&
          entry.runId === identity.runId &&
          entry.attempt === identity.attempt &&
          entry.action === metered.action,
      )
      .map((entry) => entry.ordinal + 1);
    return Math.max(0, ...ordinals);
  }

  private async prepare(
    identity: SubAgentBudgetIdentity,
    action: string,
    ordinal: number,
  ): Promise<SubAgentPendingAction> {
    const pending: SubAgentPendingAction = {
      state: "prepared",
      actionKey: [identity.sessionId, identity.runId, identity.attempt, action, ordinal].join(":"),
      sessionId: identity.sessionId,
      runId: identity.runId,
      attempt: identity.attempt,
      action,
      ordinal,
      fenceGeneration: this.generation(identity.sessionId),
    };
    await this.parts.store.flush(this.parts.store.putAction(pending));
    return pending;
  }

  private async call(
    action: SubAgentPendingAction,
    request: () => Promise<SubAgentBudgetReserveResult>,
  ): Promise<SubAgentBudgetReserveResult | null> {
    this.unsettled.set(action.actionKey, { sessionId: action.sessionId });
    try {
      return await request();
    } catch {
      return null;
    }
  }

  private resolve(
    action: SubAgentPendingAction,
    result: SubAgentBudgetReserveResult | null,
    isCurrent: () => boolean,
    request: () => Promise<SubAgentBudgetReserveResult>,
  ): SubAgentBudgetAdmission {
    if (result?.type !== "granted") this.unsettled.delete(action.actionKey);
    if (result === null) {
      this.stage(action, "unknown", { error: "budget-port-error" });
      void this.recover(action, request);
      return { type: "refused", reason: "budget-port-error", closureId: null };
    }
    if (result.type === "granted") {
      const grant = { permit: result.permit, action };
      if (!this.isCurrent(action, isCurrent)) {
        void this.settle(grant, "not-started");
        return { type: "stale" };
      }
      grant.action = this.stage(action, "reserved", undefined, result.permit);
      return { type: "granted", grant };
    }
    if (result.type === "work-denied") {
      this.stage(action, "settled", { denialId: result.denialId });
      return { type: "refused", reason: "work-budget-denied", closureId: null };
    }
    this.stage(action, "settled", { closureId: result.closureId });
    return { type: "refused", reason: "budget-denied", closureId: result.closureId };
  }

  /** Repeats the request once with the same key so a permit granted before a port error is released. */
  private async recover(
    action: SubAgentPendingAction,
    request: () => Promise<SubAgentBudgetReserveResult>,
  ): Promise<void> {
    let result: SubAgentBudgetReserveResult;
    try {
      result = await request();
    } catch {
      return;
    }
    if (result.type === "granted")
      await this.settle({ permit: result.permit, action }, "not-started");
  }

  private stage(
    action: SubAgentPendingAction,
    state: SubAgentPendingActionState,
    outcome?: ValidatedJsonValue,
    permit?: SubAgentBudgetPermit,
  ): SubAgentPendingAction {
    const next: SubAgentPendingAction = {
      ...action,
      state,
      ...(permit ? { permit: { ...permit } } : {}),
      ...(outcome === undefined ? {} : { outcome }),
    };
    if (this.disposed || !this.parts.store.record(action.sessionId)) return next;
    try {
      this.parts.store.putAction(next);
    } catch {
      return next;
    }
    return next;
  }
}
