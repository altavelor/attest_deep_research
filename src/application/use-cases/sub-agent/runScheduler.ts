import type { SubAgentExecutionResult } from "@application/ports/subAgent";
import { applySubAgentTransition, type SubAgentTransition } from "@core/research";
import { settleWithin } from "./deadline";
import { buildExecutionRequest } from "./executionRequest";
import { timestamp, type SubAgentManagerParts } from "./managerParts";

export const LOCAL_RUN_CAPACITY = 4;
export const IMPORT_TIMEOUT_MS = 30_000;
const RESULT_SUMMARY_CHARS = 1_000;

interface QueuedRun {
  sessionId: string;
  runId: string;
}

interface RunSlot extends QueuedRun {
  controller: AbortController | null;
  fenced: boolean;
}

type TransitionEvent = SubAgentTransition extends infer T
  ? T extends { at: string }
    ? Omit<T, "at">
    : never
  : never;

/**
 * Runs accepted child commands of one chat: FIFO with four local slots, a durable
 * scheduler-start before resources are allocated, and an off-lock import of the runner
 * result. Fencing a session drops its queue entry, aborts and releases its slot at once
 * and cancels its import wait, so a late completion is discarded.
 */
export class SubAgentRunScheduler {
  private readonly queue: QueuedRun[] = [];
  private readonly slots = new Map<string, RunSlot>();
  private readonly imports = new Map<string, AbortController>();

  constructor(private readonly parts: SubAgentManagerParts) {}

  get runningCount(): number {
    return this.slots.size;
  }

  enqueue(entry: QueuedRun): void {
    this.queue.push(entry);
    this.pump();
  }

  fenceSession(sessionId: string): string[] {
    const fenced: string[] = [];
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      if (this.queue[index].sessionId !== sessionId) continue;
      fenced.push(this.queue[index].runId);
      this.queue.splice(index, 1);
    }
    for (const slot of [...this.slots.values()]) {
      if (slot.sessionId !== sessionId) continue;
      fenced.push(slot.runId);
      slot.fenced = true;
      slot.controller?.abort();
      this.release(slot);
    }
    this.imports.get(sessionId)?.abort();
    this.imports.delete(sessionId);
    return fenced;
  }

  fenceAll(): void {
    this.queue.length = 0;
    for (const slot of [...this.slots.values()]) this.fenceSession(slot.sessionId);
    for (const controller of this.imports.values()) controller.abort();
    this.imports.clear();
  }

  /** Applies a transition to the session's current record and stages it; null when rejected. */
  transition(sessionId: string, event: TransitionEvent): number | null {
    const record = this.parts.store.record(sessionId);
    if (!record) return null;
    const result = applySubAgentTransition(record, {
      ...event,
      at: timestamp(this.parts),
    } as SubAgentTransition);
    if (!result.ok) return null;
    const revision = this.parts.store.putRecord(result.record, record);
    this.parts.store.tombstoneImport(result.tombstonedImport);
    return revision;
  }

  private pump(): void {
    while (this.slots.size < LOCAL_RUN_CAPACITY && this.queue.length > 0) {
      this.start(this.queue.shift()!);
    }
  }

  private start(entry: QueuedRun): void {
    const record = this.parts.store.record(entry.sessionId);
    if (
      !record ||
      record.session.activeSubAgentRunId !== entry.runId ||
      this.parts.fences.isRevoked(record.session.parentRunId)
    ) {
      return;
    }
    let revision: number | null;
    try {
      revision = this.transition(entry.sessionId, { type: "scheduler-start", runId: entry.runId });
    } catch {
      revision = null;
    }
    if (revision === null) return;
    const slot: RunSlot = { ...entry, controller: null, fenced: false };
    this.slots.set(entry.runId, slot);
    void this.execute(slot, revision);
  }

  private async execute(slot: RunSlot, startRevision: number): Promise<void> {
    try {
      await this.parts.store.flush(startRevision);
    } catch {
      this.release(slot);
      if (!slot.fenced)
        await this.settle(slot, {
          type: "provider-failed",
          runId: slot.runId,
          reason: "scheduler-start-failed",
        });
      return;
    }
    const record = this.parts.store.record(slot.sessionId);
    const run = record?.runs.find((entry) => entry.subAgentRunId === slot.runId);
    if (slot.fenced || !record || !run) return;
    slot.controller = new AbortController();
    const request = buildExecutionRequest(
      this.parts,
      record,
      run,
      slot.controller.signal,
      () => undefined,
    );
    let result: SubAgentExecutionResult | null = null;
    try {
      result = await this.parts.context.execution.run(request);
    } catch {
      result = null;
    } finally {
      this.release(slot);
    }
    if (slot.fenced) return;
    if (!result) {
      await this.settle(slot, {
        type: "provider-failed",
        runId: slot.runId,
        reason: "provider-failed",
      });
      return;
    }
    await this.complete(slot, result);
  }

  private async complete(slot: RunSlot, result: SubAgentExecutionResult): Promise<void> {
    const completed = await this.settle(slot, {
      type: "runner-completed",
      runId: slot.runId,
      usage: result.usage,
      evidenceCount: result.evidence.length,
      resultSummary: result.answerText.trim().slice(0, RESULT_SUMMARY_CHARS) || null,
    });
    const generation = this.parts.store.record(slot.sessionId)?.session.pendingImportGeneration;
    if (!completed || generation === null || generation === undefined) return;
    const fence = new AbortController();
    this.imports.set(slot.sessionId, fence);
    const outcome = await settleWithin(
      this.parts.context.evidenceImport.commit({
        sessionId: slot.sessionId,
        runId: slot.runId,
        result,
      }),
      IMPORT_TIMEOUT_MS,
      fence.signal,
    );
    if (this.imports.get(slot.sessionId) === fence) this.imports.delete(slot.sessionId);
    const session = this.parts.store.record(slot.sessionId)?.session;
    if (
      outcome.status === "fenced" ||
      !session ||
      session.status !== "importing" ||
      session.pendingImportRunId !== slot.runId ||
      session.pendingImportGeneration !== generation ||
      this.parts.fences.isRevoked(session.parentRunId)
    ) {
      return;
    }
    const imported =
      outcome.status === "done" && outcome.value.outcome.run.subAgentRunId === slot.runId
        ? outcome.value.outcome
        : null;
    if (imported) this.parts.outcomes.set(slot.runId, imported);
    await this.settle(slot, {
      type: imported ? "import-committed" : "import-failed",
      generation,
    });
  }

  /** Stages a terminal or import transition, waits for it to be durable and then notifies. */
  private async settle(slot: RunSlot, event: TransitionEvent): Promise<boolean> {
    let revision: number | null;
    try {
      revision = this.transition(slot.sessionId, event);
      if (revision === null) return false;
      await this.parts.store.flush(revision);
    } catch {
      return false;
    }
    this.parts.notifyResults();
    return true;
  }

  private release(slot: RunSlot): void {
    slot.controller = null;
    if (this.slots.get(slot.runId) !== slot) return;
    this.slots.delete(slot.runId);
    this.pump();
  }
}
