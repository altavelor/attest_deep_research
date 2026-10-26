import type { SubAgentExecutionResult } from "@application/ports/subAgent";
import {
  applySubAgentTransition,
  type ImportedSubAgentRunOutcome,
  type SubAgentSessionRecord,
  type SubAgentTransition,
} from "@core/research";
import { settleWithin } from "./deadline";
import { buildExecutionRequest } from "./executionRequest";
import { timestamp, type SubAgentManagerParts } from "./managerParts";
import { admitScopedRun } from "./scopedAdmission";
import { scopeOf, type SubAgentBudgetGrant } from "./subAgentBudget";

export const LOCAL_RUN_CAPACITY = 4;
export const IMPORT_TIMEOUT_MS = 2_000;
const RESULT_SUMMARY_CHARS = 1_000;

export interface QueuedRun {
  sessionId: string;
  runId: string;
}

export interface RunSlot extends QueuedRun {
  controller: AbortController | null;
  fenced: boolean;
  grant: SubAgentBudgetGrant | null;
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

  constructor(readonly parts: SubAgentManagerParts) {}

  get runningCount(): number {
    return this.slots.size;
  }

  enqueue(entry: QueuedRun): void {
    this.queue.push(entry);
    this.pump();
  }

  fenceSession(sessionId: string): string[] {
    const fenced: string[] = [];
    this.parts.budget.fence(sessionId);
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
    if (!this.parts.sessionOptions.has(entry.sessionId)) {
      void this.deny(entry, "execution-denied");
      return;
    }
    const scopeId = scopeOf(record.session.budgetPolicy);
    const attempt = record.runs.find((run) => run.subAgentRunId === entry.runId)?.attempt;
    if (scopeId !== null && attempt !== undefined) {
      const slot: RunSlot = { ...entry, controller: null, fenced: false, grant: null };
      this.slots.set(entry.runId, slot);
      void admitScopedRun(this, slot, { ...entry, attempt, scopeId });
      return;
    }
    let revision: number | null;
    try {
      revision = this.transition(entry.sessionId, { type: "scheduler-start", runId: entry.runId });
    } catch {
      revision = null;
    }
    if (revision === null) return;
    const slot: RunSlot = { ...entry, controller: null, fenced: false, grant: null };
    this.slots.set(entry.runId, slot);
    void this.execute(slot, revision);
  }

  async execute(slot: RunSlot, startRevision: number): Promise<void> {
    try {
      await this.parts.store.flush(startRevision);
    } catch {
      this.release(slot);
      if (slot.grant) void this.parts.budget.settle(slot.grant, "not-started");
      if (!slot.fenced)
        await this.settle(slot, {
          type: "provider-failed",
          runId: slot.runId,
          reason: "scheduler-start-failed",
        });
      return;
    }
    if (slot.grant && !(await this.startPermit(slot, slot.grant))) return;
    const record = this.parts.store.record(slot.sessionId);
    const run = record?.runs.find((entry) => entry.subAgentRunId === slot.runId);
    if (slot.fenced || !record || !run) {
      this.release(slot);
      if (slot.grant) void this.parts.budget.settle(slot.grant, "consumed");
      return;
    }
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
      if (slot.grant) void this.parts.budget.settle(slot.grant, "consumed");
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
    if (generation === null || generation === undefined) return;
    if (!completed) {
      await this.abandonImport(slot, generation);
      return;
    }
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
    if (!imported) {
      await this.settle(slot, { type: "import-failed", generation });
      return;
    }
    await this.commitImport(slot, generation, imported);
  }

  /**
   * Publishes an imported outcome only after import-committed is durable. While the
   * write is pending the run reads as pending; if it fails, the record is restored and
   * the import fails instead of exposing an unsaved answer.
   */
  private async commitImport(
    slot: RunSlot,
    generation: number,
    imported: ImportedSubAgentRunOutcome,
  ): Promise<void> {
    const before = this.parts.store.record(slot.sessionId);
    let staged: SubAgentSessionRecord | undefined;
    this.parts.unsavedImports.add(slot.runId);
    try {
      const revision = this.transition(slot.sessionId, { type: "import-committed", generation });
      if (revision === null) return;
      staged = this.parts.store.record(slot.sessionId);
      await this.parts.store.flush(revision);
      const session = this.parts.store.record(slot.sessionId)?.session;
      if (session && !this.parts.fences.isRevoked(session.parentRunId))
        this.parts.outcomes.set(slot.runId, imported);
    } catch {
      if (!before || !staged || this.parts.store.record(slot.sessionId) !== staged) return;
      try {
        this.parts.store.putRecord(before);
      } catch {
        return;
      }
      this.parts.unsavedImports.delete(slot.runId);
      await this.abandonImport(slot, generation);
      return;
    } finally {
      this.parts.unsavedImports.delete(slot.runId);
    }
    this.parts.notifyResults();
  }

  /** Durably marks the execution permit started; false when the run must not reach the runner. */
  private async startPermit(slot: RunSlot, grant: SubAgentBudgetGrant): Promise<boolean> {
    if (slot.fenced) {
      this.release(slot);
      void this.parts.budget.settle(grant, "not-started");
      return false;
    }
    const started = await this.parts.budget.start(grant, () => this.isAdmissible(slot));
    if (started === "started") return true;
    this.release(slot);
    if (started === "failed" && !slot.fenced) {
      await this.settle(slot, {
        type: "provider-failed",
        runId: slot.runId,
        reason: "budget-port-error",
      });
    }
    return false;
  }

  isAdmissible(slot: RunSlot): boolean {
    return (
      !slot.fenced &&
      this.slots.get(slot.runId) === slot &&
      !this.parts.fences.isRevoked(
        this.parts.store.record(slot.sessionId)?.session.parentRunId ?? "",
      )
    );
  }

  /** Fails a queued run that may not start, so it never runs without its limits or permit. */
  async deny(entry: QueuedRun, reason: string): Promise<void> {
    try {
      const revision = this.transition(entry.sessionId, {
        type: "execution-denied",
        runId: entry.runId,
        reason,
      });
      if (revision !== null) await this.parts.store.flush(revision);
    } catch {
      return;
    }
    this.parts.notifyResults();
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

  /** Fails an import whose completed result could not be saved, so the session never hangs in importing. */
  private async abandonImport(slot: RunSlot, generation: number): Promise<void> {
    const session = this.parts.store.record(slot.sessionId)?.session;
    if (
      session?.status !== "importing" ||
      session.pendingImportRunId !== slot.runId ||
      this.parts.fences.isRevoked(session.parentRunId)
    )
      return;
    try {
      const revision = this.transition(slot.sessionId, { type: "import-failed", generation });
      if (revision !== null) await this.parts.store.flush(revision);
    } catch {
      this.parts.notifyResults();
      return;
    }
    this.parts.notifyResults();
  }

  release(slot: RunSlot): void {
    slot.controller = null;
    if (this.slots.get(slot.runId) !== slot) return;
    this.slots.delete(slot.runId);
    this.pump();
  }
}
