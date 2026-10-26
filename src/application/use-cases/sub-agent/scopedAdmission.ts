import { denyRun } from "./runSettlement";
import type { RunSlot, SubAgentRunScheduler } from "./runScheduler";
import { closeBudgetScope } from "./scopeCleanup";
import type { SubAgentBudgetAdmission, SubAgentBudgetIdentity } from "./subAgentBudget";

/**
 * Waits for the execution permit of a required-scope run off-lock. A refusal fails
 * the queued run without resources and a global closure is cleaned up by its single
 * claim owner; a fenced run settles a late grant as not-started.
 */
export async function admitScopedRun(
  scheduler: SubAgentRunScheduler,
  slot: RunSlot,
  identity: SubAgentBudgetIdentity,
): Promise<void> {
  const isCurrent = (): boolean => scheduler.isAdmissible(slot);
  let admission: SubAgentBudgetAdmission;
  try {
    admission = await scheduler.parts.budget.admitExecution(identity, isCurrent);
  } catch {
    admission = { type: "refused", reason: "budget-port-error", closureId: null };
  }
  if (admission.type === "stale" || !isCurrent()) {
    scheduler.release(slot);
    if (admission.type === "granted")
      void scheduler.parts.budget.settle(admission.grant, "not-started");
    return;
  }
  if (admission.type === "refused") {
    scheduler.release(slot);
    await denyRun(scheduler, slot, admission.reason);
    if (
      admission.closureId !== null &&
      (await scheduler.parts.budget.claimCleanup(identity.scopeId, admission.closureId))
    ) {
      await closeBudgetScope(scheduler.parts, scheduler, identity.scopeId);
    }
    return;
  }
  slot.grant = admission.grant;
  let revision: number | null;
  try {
    revision = scheduler.transition(slot.sessionId, { type: "scheduler-start", runId: slot.runId });
  } catch {
    revision = null;
  }
  if (revision === null) {
    scheduler.release(slot);
    void scheduler.parts.budget.settle(admission.grant, "not-started");
    return;
  }
  void scheduler.execute(slot, revision);
}
