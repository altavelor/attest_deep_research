import type { SubAgentWaitOptions, SubAgentWaitResult } from "@application/ports/subAgent";
import type { SubAgentResultState, SubAgentRunRef } from "@core/research";
import { scheduleTimeout } from "@shared";
import { sessionFailure } from "./SubAgentStateStore";

export const MAX_WAIT_MS = 30_000;

export interface SubAgentWaitSources {
  subscribe(listener: () => void): () => void;
  read(ref: SubAgentRunRef): SubAgentResultState;
}

/**
 * Waits until any or all requested runs reach a terminal public state. It subscribes
 * before taking the first snapshot so no signal between them is lost, re-reads only on
 * result signals and always removes its listener, timer and abort handlers on exit.
 */
export function waitForRunResults(
  sources: SubAgentWaitSources,
  refs: readonly SubAgentRunRef[],
  options: SubAgentWaitOptions,
  fence: AbortSignal,
): Promise<SubAgentWaitResult> {
  const { mode, timeoutMs, signal } = options;
  if (
    (mode !== "any" && mode !== "all") ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 0 ||
    timeoutMs > MAX_WAIT_MS
  ) {
    return Promise.reject(sessionFailure("invalid-input"));
  }
  return new Promise<SubAgentWaitResult>((resolve, reject) => {
    let open = true;
    let timer: { cancel(): void } | null = null;
    const ready = (): SubAgentRunRef[] =>
      refs.filter((ref) => sources.read(ref).state !== "pending");
    const finish = (complete: () => void): void => {
      if (!open) return;
      open = false;
      unsubscribe();
      timer?.cancel();
      signal?.removeEventListener("abort", onAbort);
      fence.removeEventListener("abort", onFence);
      complete();
    };
    const evaluate = (): void => {
      const current = ready();
      const satisfied = mode === "any" ? current.length > 0 : current.length === refs.length;
      if (satisfied) finish(() => resolve({ ready: current, timedOut: false }));
    };
    const onAbort = (): void => finish(() => reject(signal?.reason ?? new Error("Wait aborted.")));
    const onFence = (): void => finish(() => reject(sessionFailure("fenced-delivery")));
    const unsubscribe = sources.subscribe(evaluate);
    evaluate();
    if (!open) return;
    if (signal?.aborted || fence.aborted) {
      if (fence.aborted) onFence();
      else onAbort();
      return;
    }
    if (timeoutMs === 0) {
      finish(() => resolve({ ready: ready(), timedOut: true }));
      return;
    }
    signal?.addEventListener("abort", onAbort);
    fence.addEventListener("abort", onFence);
    timer = scheduleTimeout(
      () => finish(() => resolve({ ready: ready(), timedOut: true })),
      timeoutMs,
    );
  });
}
