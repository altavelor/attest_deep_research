import type { MapSourcesRunContext } from "@application/ports/mapSources";
import type { SubAgentImportedEvidenceResolver } from "@application/ports/subAgent";
import {
  deriveSubAgentTitle,
  isTerminalBatchState,
  subAgentNoticeKey,
  type MapSourcesBatchRecord,
} from "@core/research";
import {
  batchCounts,
  buildBatchResult,
  toMapSourcesOutput,
  type BatchCounts,
  type WorkerReading,
} from "./batchMatrix";

export interface MapSourcesBatchWatcherDeps extends Omit<MapSourcesRunContext, "workers"> {
  workers: MapSourcesRunContext["workers"];
  resolver: SubAgentImportedEvidenceResolver;
  startErrors(batchId: string): ReadonlyMap<string, string>;
}

interface Watch {
  unsubscribe(): void;
  running: boolean;
  again: boolean;
}

const NO_COUNTS: BatchCounts = { done: 0, failed: 0, running: 0, settled: false };

/**
 * Gathers the matrix of pending batches from result signals of the chat's child sessions,
 * never by polling. Each signal re-reads the workers of a batch once at a time, updates the
 * single batch notice with live counters and, once every worker is terminal, publishes the
 * matrix durably as an immutable terminal record and stops listening.
 */
export class MapSourcesBatchWatcher {
  private readonly watches = new Map<string, Watch>();
  private readonly latest = new Map<string, BatchCounts>();

  constructor(private readonly deps: MapSourcesBatchWatcherDeps) {}

  /** Publishes the batch notice of a newly stored batch with all of its documents waiting. */
  announce(record: MapSourcesBatchRecord): void {
    this.latest.set(record.batchId, NO_COUNTS);
    this.notice(record, NO_COUNTS);
  }

  counts(batchId: string): BatchCounts {
    return this.latest.get(batchId) ?? NO_COUNTS;
  }

  watch(batchId: string): void {
    if (this.watches.has(batchId)) return;
    const watch: Watch = { unsubscribe: () => undefined, running: false, again: false };
    this.watches.set(batchId, watch);
    watch.unsubscribe = this.deps.subscribe(() => this.schedule(batchId));
    this.schedule(batchId);
  }

  private schedule(batchId: string): void {
    const watch = this.watches.get(batchId);
    if (!watch) return;
    if (watch.running) {
      watch.again = true;
      return;
    }
    watch.running = true;
    void (async () => {
      do {
        watch.again = false;
        try {
          await this.refresh(batchId);
        } catch {
          watch.again = false;
        }
      } while (watch.again && this.watches.has(batchId));
      watch.running = false;
    })();
  }

  private async refresh(batchId: string): Promise<void> {
    const record = this.deps.batches.get(batchId);
    if (!record || isTerminalBatchState(record.state)) {
      this.stop(batchId);
      return;
    }
    const readings = await Promise.all(
      record.sourcePaths.map(async (sourcePath): Promise<WorkerReading> => {
        const ref = record.refs.find((entry) => entry.sourcePath === sourcePath)?.ref ?? null;
        const state = ref ? await this.deps.workers.getResult(ref).catch(() => null) : null;
        return { sourcePath, ref, state };
      }),
    );
    const counts = batchCounts(readings);
    const previous = this.latest.get(batchId);
    this.latest.set(batchId, counts);
    if (!counts.settled || record.state !== "pending") {
      if (!sameCounts(previous, counts)) this.notice(record, counts);
      return;
    }
    const result = await buildBatchResult(
      record,
      readings,
      this.deps.resolver,
      this.deps.redact,
      this.deps.startErrors(batchId),
    );
    const completed: MapSourcesBatchRecord = {
      ...record,
      state: "completed",
      result: toMapSourcesOutput(result),
    };
    await this.deps.batches.put(completed, true);
    this.notice(record, counts);
    this.stop(batchId);
  }

  private stop(batchId: string): void {
    const watch = this.watches.get(batchId);
    if (!watch) return;
    this.watches.delete(batchId);
    watch.unsubscribe();
  }

  private notice(record: MapSourcesBatchRecord, counts: BatchCounts): void {
    const { chatId, parentRunId } = this.deps;
    this.deps.notices.publish([
      {
        type: "notice",
        entry: {
          eventKey: subAgentNoticeKey(chatId, parentRunId, record.batchId, null, "batch"),
          parentRunId,
          description: deriveSubAgentTitle(this.deps.redact(record.question)),
          createdAt: this.deps.now().toISOString(),
          sessionId: null,
          batchId: record.batchId,
          runId: null,
          kind: "batch",
          batch: {
            total: record.sourcePaths.length,
            done: counts.done,
            running: counts.running,
            failed: counts.failed,
          },
        },
      },
    ]);
  }
}

function sameCounts(left: BatchCounts | undefined, right: BatchCounts): boolean {
  return (
    left !== undefined &&
    left.done === right.done &&
    left.failed === right.failed &&
    left.running === right.running
  );
}
