import { describe, expect, it } from "vitest";

import { settle } from "../support/async";
import {
  FakeBudgetOwner,
  launchChild,
  managerHarness,
  scopedGrant,
} from "../support/subAgentSessions";

describe("sub-agent manager and budget scope owner", () => {
  it("S1: held ledger calls never block other creates, starts or the closure cleanup", async () => {
    const owner = new FakeBudgetOwner();
    const harness = managerHarness({ budget: owner });
    harness.grants.set("scope-1", scopedGrant(harness.binding));
    const delegator = harness.delegator("scope-1");
    const releaseFirstPermit = owner.hold("beginExecution");
    const first = await launchChild(delegator, "first");
    await settle();

    const releaseFinish = owner.hold("finishSessionRegistration");
    const pendingCreate = delegator.create({ createRequestId: "create-held", title: "Held" });
    await settle();
    const second = await launchChild(delegator, "second");
    await settle();
    const whileHeld = harness.execution.requests.map((request) => request.sessionId);
    owner.seal("scope-1");
    releaseFinish();
    const held = await pendingCreate.then(
      () => "published",
      (error: { code: string }) => error.code,
    );
    releaseFirstPermit();
    await settle();
    const firstState = await delegator.getResult(
      first.session.subAgentSessionId,
      first.receipt.runId,
    );

    expect(whileHeld).toEqual([second.session.subAgentSessionId]);
    expect(held).toBe("budget-denied");
    expect(firstState.state).toBe("failed");
    expect(harness.execution.requests[0].signal.aborted).toBe(true);
    expect(owner.calls.filter((call) => call.startsWith("claim"))).toEqual([
      "claimClosureCleanup:closure-scope-1",
    ]);
    expect(owner.scope("scope-1").registrations.size).toBe(0);
  });
});
