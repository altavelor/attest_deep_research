import { scheduleTimeout } from "@shared";

export type DeadlineOutcome<T> =
  | { status: "done"; value: T }
  | { status: "failed"; error: unknown }
  | { status: "timeout" }
  | { status: "fenced" };

/**
 * Settles with the operation's outcome, with a timeout after the given delay or when the
 * optional fence aborts. The timer and fence listener are removed as soon as either
 * happens; the operation keeps running, so callers must discard its late result.
 */
export function settleWithin<T>(
  operation: Promise<T>,
  delayMs: number,
  fence?: AbortSignal,
): Promise<DeadlineOutcome<T>> {
  return new Promise((resolve) => {
    let open = true;
    const finish = (outcome: DeadlineOutcome<T>): void => {
      if (!open) return;
      open = false;
      timer.cancel();
      fence?.removeEventListener("abort", onFence);
      resolve(outcome);
    };
    const onFence = (): void => finish({ status: "fenced" });
    const timer = scheduleTimeout(() => finish({ status: "timeout" }), Math.max(0, delayMs));
    if (fence?.aborted) onFence();
    else fence?.addEventListener("abort", onFence);
    operation.then(
      (value) => finish({ status: "done", value }),
      (error: unknown) => finish({ status: "failed", error }),
    );
  });
}
