import { describe, expect, it, vi } from "vitest";

import { ChatWriteBuffer } from "@application/use-cases/chat";
import { createSubAgentSessionManager } from "@application/use-cases/sub-agent";
import { scheduleTimeout } from "@shared";
import { settle } from "../support/async";
import { chatInput, ScriptedChatRepository, subAgentSection } from "../support/chatDocuments";
import {
  delegationGrant,
  executionResult,
  FakeSubAgentExecution,
  FakeSubAgentImport,
  launchChild,
  managerHarness,
} from "../support/subAgentSessions";
import { runPastDeadline } from "../support/timers";

vi.mock("@shared", async (importOriginal) => {
  const { withGlobalTimers } = await import("../support/timers");
  return withGlobalTimers(await importOriginal<typeof import("@shared")>());
});

describe("sub-agent manager and import port", () => {
  it("S1: answers only after a durable import and then accepts a follow-up", async () => {
    const harness = managerHarness();
    const delegator = harness.delegator();
    const { session, receipt } = await launchChild(delegator, "a");
    const id = session.subAgentSessionId;
    const whileRunning = await delegator.getResult(id, receipt.runId);
    harness.imports.mode = "hold";
    harness.execution.finish(0, executionResult("Imported answer"));
    await settle();
    const whileImporting = await delegator.getResult(id, receipt.runId);
    const earlyFollowUp = await delegator
      .continue(id, { type: "follow-up", task: "More" }, "s-early")
      .catch((error: { code: string }) => error.code);

    harness.imports.release();
    await settle();
    const imported = await delegator.getResult(id, receipt.runId);
    const followUp = await delegator.continue(id, { type: "follow-up", task: "More" }, "s-2");

    expect(whileRunning.state).toBe("pending");
    expect(whileImporting.state).toBe("pending");
    expect(JSON.stringify(whileImporting)).not.toContain("Imported answer");
    expect(earlyFollowUp).toBe("invalid-state");
    expect(imported).toMatchObject({
      state: "completed",
      outcome: { answerText: "Imported answer" },
    });
    expect(followUp.sessionId).toBe(id);
  });

  it("S2: the close barrier does not wait past its budget for a hung chat write", async () => {
    const repository = new ScriptedChatRepository();
    const writer = new ChatWriteBuffer({
      repository,
      getChatId: () => "chat-1",
      onChatBound: () => undefined,
      base: subAgentSection([]),
      baseline: { content: "c", subAgents: "s" },
      now: () => new Date(),
      scheduleTimeout,
    });
    const binding = { chatSessionId: "chat-1", parentRunId: "parent-1", bindingGeneration: 1 };
    let sequence = 0;
    const manager = createSubAgentSessionManager({
      getChatId: () => "chat-1",
      repository: { load: async () => subAgentSection([]) },
      writer,
      execution: new FakeSubAgentExecution(),
      evidenceImport: new FakeSubAgentImport(),
      getCurrentParentBinding: () => binding,
      getCurrentDeliveryEpoch: () => 1,
      resolveGrant: () => delegationGrant(binding),
      now: () => new Date("2026-10-26T10:00:00.000Z"),
      createId: (prefix) => `${prefix}-${(sequence += 1)}`,
    });
    await launchChild(manager.delegatorFor(binding, { deliveryEpoch: 1, grantId: "g" }), "a");
    repository.holdNext();
    writer.markChatDirty(chatInput());

    const result = await runPastDeadline(2_000, () => manager.closeAll("parent-1", "failed"));

    expect(result).toMatchObject({ durable: false, recoveryMarkerPersisted: false });
    expect(result.failures).toEqual(["primary-drain-timeout", "recovery-marker-timeout"]);
  });
});
