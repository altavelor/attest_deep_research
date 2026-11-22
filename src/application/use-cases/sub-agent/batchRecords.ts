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
  private readonly unsaved = new Map<string, MapSourcesBatchRecord>();
  private readonly interrupted = new Map<string, MapSourcesBatchError>();

  constructor(private readonly parts: SubAgentManagerParts) {}

  async load(): Promise<void> {
    await this.parts.store.load();
  }

  get(batchId: string): MapSourcesBatchRecord | undefined {
    const stored = this.parts.store.batch(batchId);
    return stored && this.visible(stored);
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
      (entry) =>
        entry.parentRunId === parentRunId && !isTerminalBatchState(this.visible(entry).state),
    ).length;
  }

  async put(record: MapSourcesBatchRecord, durable: boolean): Promise<boolean> {
    const { store } = this.parts;
    await store.load();
    const existing = store.batch(record.batchId);
    if (existing && isTerminalBatchState(existing.state)) return false;
    const terminal = durable && isTerminalBatchState(record.state);
    if (terminal) this.unsaved.set(record.batchId, existing ?? { ...record, state: "pending" });
    const revision = store.putBatch(record);
    try {
      if (durable) await store.flush(revision);
    } catch (error) {
      if (terminal) this.reopen(existing ?? { ...record, state: "pending" }, record);
      throw error;
    } finally {
      if (terminal) this.unsaved.delete(record.batchId);
    }
    if (isTerminalBatchState(record.state)) this.parts.notifyResults();
    return true;
  }

  async interrupt(parentRunId: string, error: MapSourcesBatchError): Promise<void> {
    this.interrupted.set(parentRunId, error);
    const open = this.all().filter(
      (entry) => entry.parentRunId === parentRunId && !isTerminalBatchState(entry.state),
    );
    for (const entry of open) {
      await this.put({ ...entry, state: "interrupted", error: { ...error } }, true);
    }
  }

  /** Returns the record readers may see: the pre-write state while a terminal write is unsaved. */
  private visible(record: MapSourcesBatchRecord): MapSourcesBatchRecord {
    return this.unsaved.get(record.batchId) ?? record;
  }

  /**
   * Puts back the open record a failed terminal write replaced. When the parent run was
   * interrupted meanwhile, its interruption skipped this batch, so it is written now.
   */
  private reopen(previous: MapSourcesBatchRecord, failed: MapSourcesBatchRecord): void {
    this.parts.store.putBatch(previous);
    const error = this.interrupted.get(previous.parentRunId);
    if (!error || failed.state === "interrupted") return;
    void this.put({ ...previous, state: "interrupted", error: { ...error } }, true).catch(
      () => undefined,
    );
  }

  private all(): readonly MapSourcesBatchRecord[] {
    return this.parts.store.state?.batches ?? [];
  }
}
