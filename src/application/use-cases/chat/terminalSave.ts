import { scheduleTimeout } from "@shared";

export const TERMINAL_SAVE_WAIT_MS = 2_000;

export type SettleOutcome =
  { status: "done" } | { status: "failed"; error: unknown } | { status: "timeout" };

/**
 * Waits for a save at most the given delay. A late save keeps running and stays a
 * pending barrier of the chat writer; the caller only stops waiting for it.
 */
export function settleWithin(operation: Promise<unknown>, delayMs: number): Promise<SettleOutcome> {
  return new Promise((resolve) => {
    let open = true;
    const finish = (outcome: SettleOutcome): void => {
      if (!open) return;
      open = false;
      timer.cancel();
      resolve(outcome);
    };
    const timer = scheduleTimeout(() => finish({ status: "timeout" }), delayMs);
    operation.then(
      () => finish({ status: "done" }),
      (error: unknown) => finish({ status: "failed", error }),
    );
  });
}
