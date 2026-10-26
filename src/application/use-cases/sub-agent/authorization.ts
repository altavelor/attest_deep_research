import type {
  SubAgentDelegationGrant,
  SubAgentSessionManagerContext,
} from "@application/ports/subAgent";
import {
  isBoundToParentRun,
  type ParentRunBinding,
  type ParentRunDeliveryContext,
  type SubAgentSessionRecord,
} from "@core/research";
import type { ParentFences } from "./parentFences";
import { sessionFailure, type SubAgentStateStore } from "./SubAgentStateStore";

const LOCAL_BUDGET_MODES: readonly string[] = ["thinking"];

type AuthorizationContext = Pick<
  SubAgentSessionManagerContext,
  "getCurrentParentBinding" | "getCurrentDeliveryEpoch" | "resolveGrant"
>;

/**
 * Checks a facade call against the private probes before any allocation. The binding
 * must match the bound chat, the current nonterminal parent run and the registered grant;
 * every mismatch gives the same not-authorized answer and a stale delivery epoch is fenced.
 */
export function authorizeCall(
  context: AuthorizationContext,
  fences: ParentFences,
  store: SubAgentStateStore,
  binding: ParentRunBinding,
  delivery: ParentRunDeliveryContext,
): SubAgentDelegationGrant {
  const grant = context.resolveGrant(delivery.grantId);
  if (
    fences.isRevoked(binding.parentRunId) ||
    store.state?.chatId !== binding.chatSessionId ||
    !sameBinding(context.getCurrentParentBinding(), binding) ||
    !grant ||
    !sameBinding(grant.binding, binding) ||
    !LOCAL_BUDGET_MODES.includes(grant.callerMode) ||
    grant.budgetPolicy.type !== "local"
  ) {
    throw sessionFailure("not-authorized");
  }
  if (context.getCurrentDeliveryEpoch() !== delivery.deliveryEpoch) {
    throw sessionFailure("fenced-delivery");
  }
  return grant;
}

/** Returns the session record only when it belongs to the binding, otherwise not-authorized. */
export function ownedRecord(
  store: SubAgentStateStore,
  binding: ParentRunBinding,
  sessionId: string,
): SubAgentSessionRecord {
  const record = store.record(sessionId);
  if (!record || !isBoundToParentRun(record.session, binding)) {
    throw sessionFailure("not-authorized");
  }
  return record;
}

function sameBinding(left: ParentRunBinding | null, right: ParentRunBinding): boolean {
  return (
    left !== null &&
    left.chatSessionId === right.chatSessionId &&
    left.parentRunId === right.parentRunId &&
    left.bindingGeneration === right.bindingGeneration
  );
}
