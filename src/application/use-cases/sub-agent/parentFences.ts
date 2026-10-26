import { sessionFailure } from "./SubAgentStateStore";

interface PendingDelivery {
  parentRunId: string;
  controller: AbortController;
  reject(error: Error): void;
}

/**
 * Tracks revoked parent runs and every facade promise still waiting for delivery.
 * Revoking a parent run or disposing the manager rejects its pending promises at once
 * with fenced-delivery and aborts the fence signal each operation received.
 */
export class ParentFences {
  private readonly revoked = new Set<string>();
  private readonly pending = new Set<PendingDelivery>();
  private disposedAll = false;

  get disposed(): boolean {
    return this.disposedAll;
  }

  isRevoked(parentRunId: string): boolean {
    return this.disposedAll || this.revoked.has(parentRunId);
  }

  revoke(parentRunId: string): void {
    this.revoked.add(parentRunId);
    this.fence((entry) => entry.parentRunId === parentRunId);
  }

  disposeAll(): void {
    this.disposedAll = true;
    this.fence(() => true);
  }

  deliver<T>(parentRunId: string, operation: (fence: AbortSignal) => Promise<T>): Promise<T> {
    if (this.isRevoked(parentRunId)) return Promise.reject(sessionFailure("fenced-delivery"));
    return new Promise<T>((resolve, reject) => {
      const entry: PendingDelivery = { parentRunId, controller: new AbortController(), reject };
      this.pending.add(entry);
      const settle = (complete: () => void): void => {
        if (!this.pending.delete(entry)) return;
        if (this.isRevoked(parentRunId)) reject(sessionFailure("fenced-delivery"));
        else complete();
      };
      let running: Promise<T>;
      try {
        running = operation(entry.controller.signal);
      } catch (error) {
        running = Promise.reject(error);
      }
      running.then(
        (value) => settle(() => resolve(value)),
        (error: unknown) => settle(() => reject(error)),
      );
    });
  }

  private fence(matches: (entry: PendingDelivery) => boolean): void {
    for (const entry of [...this.pending]) {
      if (!matches(entry)) continue;
      this.pending.delete(entry);
      entry.controller.abort();
      entry.reject(sessionFailure("fenced-delivery"));
    }
  }
}
