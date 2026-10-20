import { vi } from "vitest";

import type * as Shared from "@shared";

/** Returns the shared module with `scheduleTimeout` on the global timers, which `vi.useFakeTimers` controls; mock `@shared` with it. */
export function withGlobalTimers(shared: typeof Shared): typeof Shared {
  return {
    ...shared,
    scheduleTimeout: (callback: () => void, delayMs: number) => {
      const handle = setTimeout(callback, delayMs);
      return { cancel: () => clearTimeout(handle) };
    },
  };
}

/** Runs an operation under a fake clock and advances it by exactly the given time, so a deadline elapses without waiting on the real clock. */
export async function runPastDeadline<T>(
  elapsedMs: number,
  operation: () => Promise<T>,
): Promise<T> {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  try {
    const pending = operation();
    await vi.advanceTimersByTimeAsync(elapsedMs);
    return await pending;
  } finally {
    vi.useRealTimers();
  }
}
