import type {
  SubAgentBudgetClosureReason,
  SubAgentBudgetPermit,
  SubAgentBudgetPermitPort,
  SubAgentBudgetRegistration,
  SubAgentBudgetRegistrationFinishResult,
  SubAgentBudgetRegistrationResult,
  SubAgentBudgetRequest,
  SubAgentBudgetReserveResult,
} from "@application/ports/subAgent";
import {
  parseResearchScope,
  type BranchAllocation,
  type ResearchBudgetOwner,
} from "@core/research/deepResearch";

export interface ResearchBudgetPermitsOptions {
  researchId: string;
  owner: ResearchBudgetOwner;
  sessionCeiling: number;
  sessionByBranch: Readonly<Record<string, string>>;
  now(): Date;
  onClosed(): void;
}

interface Closure {
  closureId: string;
  closedAt: string;
  reason: SubAgentBudgetClosureReason;
}

/**
 * The permit port of one research, backed by its in-memory budget owner as the only ledger. Session
 * registration records the branch's child session within the ceiling, an execution permit binds to
 * the branch's open allocation that the scheduler already charged, evidence appends are charged to
 * the owner, and the first cleanup claim of each scope and closure wins.
 */
export class ResearchBudgetPermits implements SubAgentBudgetPermitPort {
  private readonly sessions: Record<string, string>;
  private readonly registering = new Map<string, string>();
  private readonly executions = new Map<string, SubAgentBudgetPermit>();
  private readonly boundAllocations = new Map<string, string>();
  private readonly reserved = new Map<string, SubAgentBudgetPermit>();
  private readonly claims = new Set<string>();
  private closure: Closure | null = null;

  constructor(private readonly options: ResearchBudgetPermitsOptions) {
    this.sessions = { ...options.sessionByBranch };
  }

  get researchId(): string {
    return this.options.researchId;
  }

  sessionByBranch(): Readonly<Record<string, string>> {
    return { ...this.sessions };
  }

  async beginSessionRegistration(
    scopeId: string,
    creationKey: string,
  ): Promise<SubAgentBudgetRegistrationResult> {
    const branchId = this.branchOf(scopeId);
    const closure = this.currentClosure();
    if (closure) return { type: "denied", creationKey, ...closure };
    const distinct = new Set([...Object.keys(this.sessions), ...this.registering.values()]);
    if (this.sessions[branchId] !== undefined || distinct.size >= this.options.sessionCeiling) {
      throw new Error("The research has no child session left for this branch.");
    }
    const registrationId = `registration-${creationKey}`;
    this.registering.set(registrationId, branchId);
    return {
      type: "registered",
      registration: { registrationId, scopeId, creationKey, generation: 1 },
    };
  }

  async finishSessionRegistration(
    registration: SubAgentBudgetRegistration,
    outcome: { type: "published"; sessionId: string } | { type: "aborted" },
  ): Promise<SubAgentBudgetRegistrationFinishResult> {
    const branchId = this.registering.get(registration.registrationId);
    this.registering.delete(registration.registrationId);
    if (outcome.type === "aborted") return { type: "accepted" };
    const closure = this.currentClosure();
    if (closure) return { type: "closed", ...closure };
    if (branchId === undefined || this.branchOf(registration.scopeId) !== branchId) {
      throw new Error("The session registration is unknown.");
    }
    this.sessions[branchId] = outcome.sessionId;
    return { type: "accepted" };
  }

  async beginExecution(scopeId: string, actionKey: string): Promise<SubAgentBudgetReserveResult> {
    const branchId = this.branchOf(scopeId);
    const replay = this.executions.get(actionKey);
    if (replay) return { type: "granted", permit: replay };
    const closure = this.currentClosure();
    if (closure) return { type: "denied", actionKey, ...closure };
    const allocation = this.openAllocationOf(branchId);
    if (!allocation) {
      return {
        type: "work-denied",
        denialId: `denial-${actionKey}`,
        actionKey,
        reason: "per-work-attempt-limit",
      };
    }
    const permit = { permitId: `permit-${actionKey}`, scopeId, actionKey };
    this.boundAllocations.set(allocationKey(allocation), actionKey);
    this.executions.set(actionKey, permit);
    return { type: "granted", permit };
  }

  async reserve(
    scopeId: string,
    request: SubAgentBudgetRequest,
  ): Promise<SubAgentBudgetReserveResult> {
    this.branchOf(scopeId);
    const replay = this.reserved.get(request.actionKey);
    if (replay) return { type: "granted", permit: replay };
    const items = request.action === "evidence-append" ? (request.units.evidenceItems ?? 0) : 0;
    const wasOpen = this.options.owner.snapshot().closed === null;
    const granted = this.options.owner.chargeEvidence(items);
    if (wasOpen && this.options.owner.snapshot().closed) this.options.onClosed();
    if (!granted)
      return { type: "denied", actionKey: request.actionKey, ...this.currentClosure()! };
    const permit = {
      permitId: `permit-${request.actionKey}`,
      scopeId,
      actionKey: request.actionKey,
    };
    this.reserved.set(request.actionKey, permit);
    return { type: "granted", permit };
  }

  async markStarted(permit: SubAgentBudgetPermit): Promise<void> {
    this.branchOf(permit.scopeId);
  }

  async settle(permit: SubAgentBudgetPermit): Promise<void> {
    this.branchOf(permit.scopeId);
  }

  async claimClosureCleanup(scopeId: string, closureId: string): Promise<boolean> {
    this.branchOf(scopeId);
    const key = `${scopeId}\u0000${closureId}`;
    if (this.currentClosure()?.closureId !== closureId || this.claims.has(key)) return false;
    this.claims.add(key);
    return true;
  }

  private openAllocationOf(branchId: string): BranchAllocation | undefined {
    return this.options.owner
      .snapshot()
      .openAllocations.find(
        (allocation) =>
          allocation.branchId === branchId && !this.boundAllocations.has(allocationKey(allocation)),
      );
  }

  private currentClosure(): Closure | null {
    const closed = this.options.owner.snapshot().closed;
    if (!closed) return null;
    this.closure ??= {
      closureId: `closure-${this.options.researchId}-${closed.reason}`,
      closedAt: this.options.now().toISOString(),
      reason:
        closed.reason === "time"
          ? { type: "deadline" }
          : { type: "exhausted", dimension: exhaustedUnit(closed.dimension) },
    };
    return this.closure;
  }

  private branchOf(scopeId: string): string {
    const scope = parseResearchScope(scopeId);
    if (!scope || scope.researchId !== this.options.researchId) {
      throw new Error("The budget scope does not belong to this research.");
    }
    return scope.branchId;
  }
}

function allocationKey(allocation: BranchAllocation): string {
  return `${allocation.workId}\u0000${allocation.attempt}`;
}

function exhaustedUnit(
  dimension: string | null,
): Extract<SubAgentBudgetClosureReason, { type: "exhausted" }>["dimension"] {
  return dimension === "modelRounds" || dimension === "searches" || dimension === "evidenceItems"
    ? dimension
    : "branchAttempts";
}
