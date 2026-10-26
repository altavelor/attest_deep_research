import { describe, expect, it, vi } from "vitest";

import { SubAgentParentCoordinator } from "@application/use-cases/sub-agent";
import { settle } from "../support/async";
import { resultBoard } from "../support/subAgentSessions";
import { runPastDeadline } from "../support/timers";

vi.mock("@shared", async (importOriginal) => {
  const { withGlobalTimers } = await import("../support/timers");
  return withGlobalTimers(await importOriginal<typeof import("@shared")>());
});

function coordinatorOver(board: ReturnType<typeof resultBoard>, logError?: (e: unknown) => void) {
  return new SubAgentParentCoordinator({
    delegator: board.delegator as never,
    host: board.host,
    parentRunId: "parent-1",
    ...(logError ? { logError } : {}),
  });
}

describe("SubAgentParentCoordinator", () => {
  it("U3a: holds the final answer for pending children on signals only, without losing one, within the bound", async () => {
    const board = resultBoard();
    board.set("r1", "pending");
    const coordinator = coordinatorOver(board);
    let decision: string | null = null;
    void coordinator.beforeFinalize().then((value) => (decision = value));
    await settle();
    const readsWhileWaiting = board.reads.length;
    await settle();
    expect(decision).toBeNull();
    expect(board.reads).toHaveLength(readsWhileWaiting);

    board.signal();
    await settle();
    expect(decision).toBeNull();

    let freshDecision: string | null = null;
    const fresh = coordinatorOver(board);
    board.onRead = () => {
      board.onRead = () => undefined;
      board.set("r1", "completed");
      board.signal();
    };
    void fresh.beforeFinalize().then((value) => (freshDecision = value));
    await settle();
    expect(freshDecision).toBe("resume-with-results");

    const delivered = await fresh.beforeModelRound();
    fresh.acknowledgeResults(
      delivered.map(({ ref, result }) => ({ ref, resultRevision: result.resultRevision })),
    );
    expect(await fresh.beforeFinalize()).toBe("ready");
    coordinator.dispose();
    fresh.dispose();
    const held = resultBoard();
    held.set("r2", "pending");
    const heldCoordinator = coordinatorOver(held);
    const released = heldCoordinator.beforeFinalize();
    await settle();
    heldCoordinator.dispose();
    expect(await released).toBe("ready");

    const bounded = resultBoard();
    bounded.unreadable.add("r3");
    bounded.closeFailure = new Error("Close failed.");
    const logged: unknown[] = [];
    const boundedCoordinator = coordinatorOver(bounded, (error) => logged.push(error));
    expect(
      await runPastDeadline(SubAgentParentCoordinator.maxFinalizeWaitMs, () =>
        boundedCoordinator.beforeFinalize(),
      ),
    ).toBe("ready");
    expect(bounded.closed).toEqual(["finalize-timeout"]);
    expect(logged).toEqual([bounded.closeFailure]);
    expect(bounded.listenerCount()).toBe(0);
    expect(board.closed).toEqual([]);
  });

  it("U3b: wakes one waiting loop for a success, a failure, a stop and a bounded import failure", async () => {
    const board = resultBoard();
    const coordinator = coordinatorOver(board);
    const outcomes: [string, number][] = [];
    for (const [runId, state, code] of [
      ["ok", "completed", "-"],
      ["bad", "failed", "provider-error"],
      ["halt", "interrupted", "stopped"],
      ["import", "failed", "import-failed"],
    ] as const) {
      board.set(runId, "pending");
      const waiting = coordinator.beforeFinalize();
      await settle();
      board.set(runId, state, 1, code);
      board.signal();
      board.signal();
      outcomes.push([await waiting, board.listenerCount()]);
      const delivered = await coordinator.beforeModelRound();
      expect(delivered.map(({ ref }) => ref.runId)).toEqual([runId]);
      coordinator.acknowledgeResults([{ ref: delivered[0]!.ref, resultRevision: 1 }]);
    }

    expect(outcomes).toEqual(Array(4).fill(["resume-with-results", 0]));
  });

  it("U3c: delivers a repaired result revision again and releases a wait the user cancelled", async () => {
    const board = resultBoard();
    const coordinator = coordinatorOver(board);
    board.set("r1", "failed", 1, "import-failed");
    const first = await coordinator.beforeModelRound();
    coordinator.acknowledgeResults([{ ref: first[0]!.ref, resultRevision: 1 }]);
    expect(await coordinator.beforeModelRound()).toEqual([]);

    board.set("r1", "completed", 2);
    const repaired = await coordinator.beforeModelRound();
    expect(repaired.map(({ result }) => result.state)).toEqual(["completed"]);
    coordinator.acknowledgeResults([{ ref: repaired[0]!.ref, resultRevision: 2 }]);

    board.set("r2", "pending");
    const controller = new AbortController();
    const waiting = coordinator.beforeFinalize(controller.signal);
    await settle();
    controller.abort(new DOMException("Cancelled by user", "AbortError"));

    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    expect(board.listenerCount()).toBe(0);
    coordinator.dispose();
  });
});
