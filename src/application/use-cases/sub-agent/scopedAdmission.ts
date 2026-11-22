import { isRecord } from "@shared";
import { SubAgentSessionFailure } from "@core/research";
import { denyRun } from "./runSettlement";
import type { RunSlot, SubAgentRunScheduler } from "./runScheduler";
import { closeBudgetScope } from "./scopeCleanup";
import {
  scopeOf,
  type SubAgentBudgetAdmission,
  type SubAgentBudgetIdentity,
} from "./subAgentBudget";

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
    if (admission.closureId !== null) {
      await cleanUpClosure(scheduler, identity.scopeId, admission.closureId);
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

/** Cleans up a globally closed scope once this caller wins its single cleanup claim. */
async function cleanUpClosure(
  scheduler: SubAgentRunScheduler,
  scopeId: string,
  closureId: string,
): Promise<void> {
  if (await scheduler.parts.budget.claimCleanup(scopeId, closureId)) {
    await closeBudgetScope(scheduler.parts, scheduler, scopeId);
  }
}

/**
 * Cleans up the scope of a session whose metered action failed on a global closure, so a
 * closure first met by an evidence append stops the whole scope like a refused admission.
 */
export async function cleanUpMeteredClosure(
  scheduler: SubAgentRunScheduler,
  sessionId: string,
  failure: unknown,
): Promise<void> {
  const details = failure instanceof SubAgentSessionFailure ? failure.error.details : undefined;
  const closureId = isRecord(details) ? details.closureId : undefined;
  const record = scheduler.parts.store.record(sessionId);
  const scopeId = record ? scopeOf(record.session.budgetPolicy) : null;
  if (typeof closureId === "string" && scopeId !== null) {
    await cleanUpClosure(scheduler, scopeId, closureId);
  }
}
