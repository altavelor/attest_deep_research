import { CLOSE_DEADLINE_MS } from "@application/use-cases/sub-agent";
import { scheduleTimeout } from "@shared";

export const TERMINAL_SAVE_WAIT_MS = CLOSE_DEADLINE_MS + 2_000;

export type SettleOutcome =
  { status: "done" } | { status: "failed"; error: unknown } | { status: "timeout" };

export interface TerminalBudget {
  within(operation: Promise<unknown>): Promise<SettleOutcome>;
  cancel(): void;
}

/**
 * Starts one shared wait budget for closing a run's children and its terminal save.
 * Each wait ends when its operation settles or the shared budget runs out; a late
 * operation keeps running, so a late save stays a pending barrier of the chat writer.
 */
export function terminalBudget(delayMs = TERMINAL_SAVE_WAIT_MS): TerminalBudget {
  let expire = (): void => undefined;
  const expired = new Promise<void>((resolve) => (expire = resolve));
  const timer = scheduleTimeout(() => expire(), delayMs);
  return {
    within: (operation) =>
      Promise.race([
        operation.then(
          (): SettleOutcome => ({ status: "done" }),
          (error: unknown): SettleOutcome => ({ status: "failed", error }),
        ),
        expired.then((): SettleOutcome => ({ status: "timeout" })),
      ]),
    cancel: () => {
      timer.cancel();
      expire();
    },
  };
}
