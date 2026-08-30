declare const process: {
  getBuiltinModule(name: "timers"): {
    setTimeout(callback: () => void, delayMs: number): unknown;
    clearTimeout(handle: unknown): void;
  };
};

export interface ScheduledTimeout {
  cancel(): void;
}

/** Schedules a cancelable timeout in the current runtime's stable timer realm. */
export function scheduleTimeout(callback: () => void, delayMs: number): ScheduledTimeout {
  if (typeof window !== "undefined") {
    const handle = window.setTimeout(callback, delayMs);
    return { cancel: () => window.clearTimeout(handle) };
  }

  const timers = process.getBuiltinModule("timers");
  const handle = timers.setTimeout(callback, delayMs);
  return { cancel: () => timers.clearTimeout(handle) };
}
