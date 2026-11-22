import type {
  SubAgentBudgetPermit,
  SubAgentBudgetPermitPort,
  SubAgentBudgetRegistration,
  SubAgentBudgetRegistrationFinishResult,
  SubAgentBudgetRegistrationResult,
  SubAgentBudgetRequest,
  SubAgentBudgetReserveResult,
} from "@application/ports/subAgent";
import { parseResearchScope } from "@core/research/deepResearch";

export interface AttachedResearchBudget extends SubAgentBudgetPermitPort {
  readonly researchId: string;
}

/**
 * The budget port one chat's session manager receives. It routes each scope to the permit port of
 * the chat's active research; an unknown scope, a foreign research or no active research is
 * refused, never treated as a local budget.
 */
export class ResearchScopeRouter implements SubAgentBudgetPermitPort {
  private active: AttachedResearchBudget | null = null;

  attach(port: AttachedResearchBudget): () => void {
    this.active = port;
    return () => {
      if (this.active === port) this.active = null;
    };
  }

  activeResearchId(): string | null {
    return this.active?.researchId ?? null;
  }

  async beginSessionRegistration(
    scopeId: string,
    creationKey: string,
  ): Promise<SubAgentBudgetRegistrationResult> {
    return this.owner(scopeId).beginSessionRegistration(scopeId, creationKey);
  }

  async finishSessionRegistration(
    registration: SubAgentBudgetRegistration,
    outcome: { type: "published"; sessionId: string } | { type: "aborted" },
  ): Promise<SubAgentBudgetRegistrationFinishResult> {
    return this.owner(registration.scopeId).finishSessionRegistration(registration, outcome);
  }

  async beginExecution(scopeId: string, actionKey: string): Promise<SubAgentBudgetReserveResult> {
    return this.owner(scopeId).beginExecution(scopeId, actionKey);
  }

  async reserve(
    scopeId: string,
    request: SubAgentBudgetRequest,
  ): Promise<SubAgentBudgetReserveResult> {
    return this.owner(scopeId).reserve(scopeId, request);
  }

  async markStarted(permit: SubAgentBudgetPermit): Promise<void> {
    return this.owner(permit.scopeId).markStarted(permit);
  }

  async settle(permit: SubAgentBudgetPermit, outcome: "consumed" | "not-started"): Promise<void> {
    return this.owner(permit.scopeId).settle(permit, outcome);
  }

  async claimClosureCleanup(scopeId: string, closureId: string): Promise<boolean> {
    return this.owner(scopeId).claimClosureCleanup(scopeId, closureId);
  }

  private owner(scopeId: string): SubAgentBudgetPermitPort {
    const scope = parseResearchScope(scopeId);
    const active = this.active;
    if (!scope || !active || scope.researchId !== active.researchId) {
      throw new Error("The budget scope belongs to no active research of this chat.");
    }
    return active;
  }
}
