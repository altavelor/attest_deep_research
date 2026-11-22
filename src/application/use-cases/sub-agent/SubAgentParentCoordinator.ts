import type {
  SubAgentDeliveredResult,
  SubAgentDelegator,
  SubAgentHost,
  SubAgentParentCoordinatorPort,
} from "@application/ports/subAgent";
import type { SubAgentRunRef } from "@core/research";
import { scheduleTimeout } from "@shared";

export interface SubAgentParentCoordinatorDeps {
  delegator: Pick<SubAgentDelegator, "getResult">;
  host: Pick<SubAgentHost, "subscribeResults" | "listRunRefs" | "closeAll">;
  parentRunId: string;
  pendingBatches?(): number;
  maxFinalizeWaitMs?: number;
  logError?(error: unknown): void;
}

/**
 * Delivers the terminal results of one parent run's children at model round boundaries
 * and keeps the parent from publishing a final answer while children are pending. It
 * waits on result signals only, never polls, and bounds the whole finalize wait of the
 * parent run once; when that bound passes, every child is closed as finalize-timeout.
 * A child whose result cannot be read counts as pending until that bound, and so does
 * an unfinished map_sources batch of the run until its matrix is published.
 */
export class SubAgentParentCoordinator implements SubAgentParentCoordinatorPort {
  static readonly maxFinalizeWaitMs = 600_000;

  private readonly acknowledged = new Map<string, number>();
  private deadline: { expired: boolean; reached: Promise<void>; cancel(): void } | null = null;
  private disposed = false;
  private release = (): void => undefined;
  private readonly released = new Promise<void>((resolve) => (this.release = resolve));

  constructor(private readonly deps: SubAgentParentCoordinatorDeps) {}

  async beforeModelRound(): Promise<readonly SubAgentDeliveredResult[]> {
    return (await this.scan()).undelivered;
  }

  acknowledgeResults(results: readonly { ref: SubAgentRunRef; resultRevision: number }[]): void {
    for (const { ref, resultRevision } of results) {
      const key = refKey(ref);
      this.acknowledged.set(key, Math.max(this.acknowledged.get(key) ?? -1, resultRevision));
    }
  }

  async beforeFinalize(signal?: AbortSignal): Promise<"ready" | "resume-with-results"> {
    for (;;) {
      let wake = (): void => undefined;
      const changed = new Promise<void>((resolve) => (wake = resolve));
      const unsubscribe = this.deps.host.subscribeResults(() => wake());
      try {
        if (this.disposed) return "ready";
        const { undelivered, pending } = await this.scan();
        if (undelivered.length > 0) return "resume-with-results";
        if (pending === 0) return "ready";
        const deadline = this.startDeadline();
        if (deadline.expired) {
          await this.deps.host
            .closeAll(this.deps.parentRunId, "finalize-timeout")
            .catch((error: unknown) => this.deps.logError?.(error));
          return "ready";
        }
        await waitFor([changed, deadline.reached, this.released], signal);
      } finally {
        unsubscribe();
      }
    }
  }

  /** Cancels the finalize deadline and releases a waiting finalize, which then reports ready. */
  dispose(): void {
    this.disposed = true;
    this.deadline?.cancel();
    this.release();
  }

  private async scan(): Promise<{ undelivered: SubAgentDeliveredResult[]; pending: number }> {
    const refs = this.deps.host.listRunRefs(this.deps.parentRunId);
    const undelivered: SubAgentDeliveredResult[] = [];
    let pending = this.deps.pendingBatches?.() ?? 0;
    for (const ref of refs) {
      const result = await this.deps.delegator
        .getResult(ref.sessionId, ref.runId)
        .catch(() => null);
      if (!result || result.state === "pending") {
        pending += 1;
      } else if ((this.acknowledged.get(refKey(ref)) ?? -1) < result.resultRevision) {
        undelivered.push({ ref, result });
      }
    }
    return { undelivered, pending };
  }

  private startDeadline(): NonNullable<SubAgentParentCoordinator["deadline"]> {
    if (this.deadline) return this.deadline;
    let reach = (): void => undefined;
    const reached = new Promise<void>((resolve) => (reach = resolve));
    const state = { expired: false, reached, cancel: () => timer.cancel() };
    const timer = scheduleTimeout(() => {
      state.expired = true;
      reach();
    }, this.deps.maxFinalizeWaitMs ?? SubAgentParentCoordinator.maxFinalizeWaitMs);
    this.deadline = state;
    return state;
  }
}

function refKey(ref: SubAgentRunRef): string {
  return `${ref.sessionId}\u0000${ref.runId}`;
}

function waitFor(events: readonly Promise<void>[], signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError(signal));
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => reject(abortError(signal!));
    signal?.addEventListener("abort", onAbort, { once: true });
    void Promise.race(events).then(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    });
  });
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Cancelled", "AbortError");
}
