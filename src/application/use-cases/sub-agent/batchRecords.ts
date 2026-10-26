import type { SubAgentBatchStore } from "@application/ports/subAgent";
import {
  isTerminalBatchState,
  type MapSourcesBatchError,
  type MapSourcesBatchRecord,
  type SubAgentRunRef,
} from "@core/research";
import type { SubAgentManagerParts } from "./managerParts";

/**
 * Keeps the map_sources batches of the manager's own chat section. Records are staged
 * through the same durable writer as sessions; a terminal record is immutable and its
 * publication wakes the result listeners, so a finalize barrier sees the batch settle.
 */
export class SubAgentBatchRecords implements SubAgentBatchStore {
  constructor(private readonly parts: SubAgentManagerParts) {}

  async load(): Promise<void> {
    await this.parts.store.load();
  }

  get(batchId: string): MapSourcesBatchRecord | undefined {
    return this.parts.store.batch(batchId);
  }

  batchOf(ref: SubAgentRunRef): string | null {
    const batch = this.all().find((entry) =>
      entry.refs.some(
        (item) => item.ref.sessionId === ref.sessionId && item.ref.runId === ref.runId,
      ),
    );
    return batch?.batchId ?? null;
  }

  pendingCount(parentRunId: string): number {
    return this.all().filter(
      (entry) => entry.parentRunId === parentRunId && !isTerminalBatchState(entry.state),
    ).length;
  }

  async put(record: MapSourcesBatchRecord, durable: boolean): Promise<boolean> {
    const { store } = this.parts;
    await store.load();
    const existing = store.batch(record.batchId);
    if (existing && isTerminalBatchState(existing.state)) return false;
    const revision = store.putBatch(record);
    if (durable) await store.flush(revision);
    if (isTerminalBatchState(record.state)) this.parts.notifyResults();
    return true;
  }

  async interrupt(parentRunId: string, error: MapSourcesBatchError): Promise<void> {
    const open = this.all().filter(
      (entry) => entry.parentRunId === parentRunId && !isTerminalBatchState(entry.state),
    );
    for (const entry of open) {
      await this.put({ ...entry, state: "interrupted", error: { ...error } }, true);
    }
  }

  private all(): readonly MapSourcesBatchRecord[] {
    return this.parts.store.state?.batches ?? [];
  }
}
