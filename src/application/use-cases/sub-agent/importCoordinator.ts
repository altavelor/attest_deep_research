import type {
  SubAgentEvidenceImportPort,
  SubAgentExecutionResult,
  SubAgentImportLookup,
  SubAgentImportRequest,
  SubAgentImportResult,
  SubAgentPreparedImport,
  SubAgentPreparedImportRequest,
} from "@application/ports/subAgent";
import {
  readSubAgentImportItems,
  subAgentAliasPrefix,
  toValidatedJson,
  type ImportedSubAgentRunOutcome,
  type SubAgentImportRecord,
} from "@core/research";
import { settleWithin } from "./deadline";
import { checkedAliases } from "./importAliases";
import {
  importedRunSummary,
  matchesImportDigest,
  normalizeWebUrl,
  planSubAgentImport,
  type SubAgentImportPlan,
} from "./importPlan";
import { timestamp, type SubAgentManagerParts } from "./managerParts";
import { scopeOf } from "./subAgentBudget";
import { sessionFailure } from "./SubAgentStateStore";

export const IMPORT_TIMEOUT_MS = 2_000;

export interface SubAgentImportCommitter {
  commitImport(
    ref: { sessionId: string; runId: string },
    generation: number,
    imported: ImportedSubAgentRunOutcome,
  ): Promise<void>;
}

/**
 * Two-phase import of child results into the chat. Prepare stages a deterministic
 * import record in the runner's terminal barrier; commit hands its aliases to the chat
 * evidence bridge off-lock and checks that every admitted element got one. A tombstone
 * or a lost parent fence always wins, and reconciliation retries a failed import once
 * per delivery epoch without re-running the child.
 */
export class SubAgentImportCoordinator implements SubAgentEvidenceImportPort, SubAgentImportLookup {
  private readonly reconciled = new Map<string, { sessionId: string; epochs: Set<number> }>();
  private readonly broken = new Set<string>();
  private readonly offsets = new Map<string, number>();
  committer: SubAgentImportCommitter | null = null;

  constructor(
    private readonly parts: SubAgentManagerParts,
    private readonly bridge: SubAgentEvidenceImportPort,
  ) {}

  /**
   * Plans the import of a finished run before its runner-completed transition is staged,
   * so the staged summary is already rewritten. The run is incomplete when it continues
   * a partial run or the runner says so; that flag never enters the digest.
   */
  plan(
    sessionId: string,
    runId: string,
    result: SubAgentExecutionResult,
  ): SubAgentImportPlan | null {
    const { store } = this.parts;
    const record = store.record(sessionId);
    const run = record?.runs.find((entry) => entry.subAgentRunId === runId);
    if (!record || !run || !store.state) return null;
    return planSubAgentImport({
      chatId: store.state.chatId,
      sessionId,
      runId,
      generation: record.session.lastImportGeneration + 1,
      attempt: run.attempt,
      policy: run.effectiveSourcePolicy,
      resources: this.parts.sessionOptions.get(sessionId)?.resources ?? [],
      webCapacity: this.webCapacity(sessionId),
      incomplete: run.continuedFromRunId !== null || result.incomplete,
      result,
      now: timestamp(this.parts),
    });
  }

  /** Stages the prepare record of a planned import in the runner's terminal barrier. */
  stage({ prepared, evidenceDigest }: SubAgentImportPlan): void {
    const generation = this.parts.store.record(prepared.sessionId)?.session.pendingImportGeneration;
    if (generation !== prepared.generation) return;
    this.attempted(prepared, this.parts.context.getCurrentDeliveryEpoch());
    if (this.importRecord(prepared.importId)) return;
    this.parts.store.putImport({
      state: "prepared",
      importId: prepared.importId,
      chatId: prepared.chatId,
      sessionId: prepared.sessionId,
      runId: prepared.runId,
      evidenceDigest,
      generation: prepared.generation,
      evidence: prepared.items.flatMap((item) => toValidatedJson(item) ?? []),
      aliases: [],
      answerText: prepared.answerText,
      createdAt: timestamp(this.parts),
      ...(prepared.evidenceBudgetExhausted ? { evidenceBudgetExhausted: true } : {}),
    });
  }

  async commit(request: SubAgentImportRequest): Promise<SubAgentImportResult> {
    const prepared = this.pendingPrepared(request.sessionId, request.runId);
    if (!prepared) throw sessionFailure("import-failed");
    const record = this.parts.store.record(request.sessionId);
    const scopeId = record ? scopeOf(record.session.budgetPolicy) : null;
    const register = () => this.register(prepared, request.result);
    const outcome =
      scopeId === null || prepared.items.length === 0
        ? await register()
        : await this.parts.budget.meter(
            {
              sessionId: prepared.sessionId,
              runId: prepared.runId,
              attempt: prepared.attempt,
              scopeId,
            },
            { action: "evidence-append", units: { evidenceItems: prepared.items.length } },
            () => this.isCurrent(prepared),
            register,
          );
    return { outcome };
  }

  /** True while the run's import of this generation is prepared and may still be committed. */
  hasPrepared(sessionId: string, runId: string, generation: number): boolean {
    return this.findImport(sessionId, runId, generation)?.state === "prepared";
  }

  /** Stages the commit marker of an import inside the manager's import-committed barrier. */
  markCommitted(sessionId: string, runId: string, generation: number): SubAgentImportRecord | null {
    const entry = this.findImport(sessionId, runId, generation);
    if (!entry || entry.state !== "prepared") return null;
    this.parts.store.putImport({ ...entry, state: "committed" });
    this.reconciled.set(entry.importId, {
      sessionId,
      epochs: new Set([this.parts.context.getCurrentDeliveryEpoch()]),
    });
    return entry;
  }

  /** Restores a commit marker whose barrier failed, so the import is retried rather than trusted. */
  unmarkCommitted(entry: SubAgentImportRecord): void {
    const current = this.importRecord(entry.importId);
    if (current?.state === "committed")
      this.parts.store.putImport({ ...current, state: "prepared" });
  }

  /**
   * Starts one bounded repair of a failed import for this delivery epoch and returns at
   * once; a repeated lookup in the same epoch starts nothing. Tombstoned, archived and
   * fenced imports are never repaired.
   */
  reconcile(sessionId: string, runId: string, deliveryEpoch: number): void {
    const session = this.parts.store.record(sessionId)?.session;
    const generation = session?.pendingImportGeneration;
    if (session?.status !== "failed" || session.pendingImportRunId !== runId || !generation) return;
    const prepared = this.pendingPrepared(sessionId, runId);
    if (!prepared || !this.attempted(prepared, deliveryEpoch)) return;
    void this.repair(prepared, generation).catch(() => undefined);
  }

  /**
   * Re-registers the aliases of a committed import once per delivery epoch before its
   * marker is trusted again; when an alias cannot be restored the import reads as failed.
   */
  verify(sessionId: string, runId: string, deliveryEpoch: number): void {
    const entry = this.parts.store.state?.imports.find(
      (row) => row.sessionId === sessionId && row.runId === runId && row.state === "committed",
    );
    const prepared = entry ? this.preparedOf(entry) : null;
    if (!prepared || !this.attempted(prepared, deliveryEpoch) || !this.isCurrent(prepared)) return;
    const revision = this.parts.store.currentRevision;
    void settleWithin(
      this.register({ ...prepared, repairOnly: !this.broken.has(prepared.importId) }, null),
      IMPORT_TIMEOUT_MS,
    )
      .then(async (outcome) => {
        if (!this.isCurrent(prepared)) return;
        const healthy = outcome.status === "done";
        if (healthy === this.broken.has(prepared.importId)) {
          if (healthy) this.broken.delete(prepared.importId);
          else this.broken.add(prepared.importId);
          this.offsets.set(prepared.runId, this.revisionOffset(prepared.runId) + 1);
          this.parts.notifyResults();
        }
        if (healthy && this.parts.store.currentRevision !== revision) {
          await this.parts.store.flush(this.parts.store.currentRevision);
        }
      })
      .catch(() => undefined);
  }

  /**
   * Returns how often a run's committed import switched between broken and healthy; it is
   * kept only in memory because no lookup survives a restart, the binding being terminal.
   */
  revisionOffset(runId: string): number {
    return this.offsets.get(runId) ?? 0;
  }

  /** True when a committed import lost an alias that one repair could not restore. */
  isBroken(importId: string): boolean {
    return this.broken.has(importId);
  }

  /** Drops the repair bookkeeping of a parent's imports when the parent run closes. */
  forgetParent(parentRunId: string | null): void {
    for (const [importId, entry] of this.reconciled) {
      const session = this.parts.store.record(entry.sessionId)?.session;
      if (parentRunId === null || !session || session.parentRunId === parentRunId) {
        this.reconciled.delete(importId);
      }
    }
  }

  isCurrent(prepared: SubAgentPreparedImport): boolean {
    const entry = this.importRecord(prepared.importId);
    const session = this.parts.store.record(prepared.sessionId)?.session;
    return (
      entry !== undefined &&
      entry.state !== "tombstoned" &&
      entry.chatId === this.parts.store.state?.chatId &&
      entry.sessionId === prepared.sessionId &&
      entry.runId === prepared.runId &&
      entry.generation === prepared.generation &&
      session !== undefined &&
      session.status !== "archived" &&
      !this.parts.fences.isRevoked(session.parentRunId)
    );
  }

  committed(outcome: ImportedSubAgentRunOutcome): SubAgentImportRecord | null {
    const entry = this.importRecord(outcome.importId);
    const session = entry ? this.parts.store.record(entry.sessionId)?.session : undefined;
    if (
      !entry ||
      !session ||
      entry.state !== "committed" ||
      entry.runId !== outcome.run.subAgentRunId ||
      session.status === "archived" ||
      this.parts.fences.isRevoked(session.parentRunId)
    ) {
      return null;
    }
    return entry;
  }

  private async repair(prepared: SubAgentPreparedImport, generation: number): Promise<void> {
    const outcome = await settleWithin(this.register(prepared, null), IMPORT_TIMEOUT_MS);
    const session = this.parts.store.record(prepared.sessionId)?.session;
    if (
      outcome.status !== "done" ||
      !this.isCurrent(prepared) ||
      session?.pendingImportRunId !== prepared.runId ||
      session.pendingImportGeneration !== generation
    ) {
      return;
    }
    await this.committer?.commitImport(prepared, generation, outcome.value);
  }

  private async register(
    prepared: SubAgentPreparedImport,
    result: SubAgentExecutionResult | null,
  ): Promise<ImportedSubAgentRunOutcome> {
    const request: SubAgentPreparedImportRequest = {
      sessionId: prepared.sessionId,
      runId: prepared.runId,
      result: result ?? {
        answerText: prepared.answerText,
        evidence: [],
        usage: {
          requestCount: 0,
          modelRounds: 0,
          toolCalls: 0,
          durationMs: 0,
          source: "unavailable",
        },
        incomplete: false,
        terminalReason: null,
        telemetry: null,
      },
      prepared,
    };
    const registered = await this.bridge.commit(request);
    const aliases = checkedAliases(prepared, registered.outcome.evidence);
    const run = this.parts.store
      .record(prepared.sessionId)
      ?.runs.find((entry) => entry.subAgentRunId === prepared.runId);
    if (!aliases || !run || !this.isCurrent(prepared)) throw sessionFailure("import-failed");
    const entry = this.importRecord(prepared.importId)!;
    if (JSON.stringify(entry.aliases) !== JSON.stringify(aliases)) {
      this.parts.store.putImport({ ...entry, aliases });
    }
    return {
      run: importedRunSummary(run, prepared.answerText),
      answerText: prepared.answerText,
      evidence: aliases,
      importId: prepared.importId,
      ...(prepared.evidenceBudgetExhausted ? { evidenceBudgetExhausted: true } : {}),
    };
  }

  private pendingPrepared(sessionId: string, runId: string): SubAgentPreparedImport | null {
    const session = this.parts.store.record(sessionId)?.session;
    const generation = session?.pendingImportGeneration;
    if (!session || session.pendingImportRunId !== runId || !generation) return null;
    const entry = this.findImport(sessionId, runId, generation);
    return entry?.state === "prepared" ? this.preparedOf(entry) : null;
  }

  private preparedOf(entry: SubAgentImportRecord): SubAgentPreparedImport | null {
    const items = readSubAgentImportItems(
      entry.evidence,
      subAgentAliasPrefix(entry.importId),
      normalizeWebUrl,
    );
    const run = this.parts.store
      .record(entry.sessionId)
      ?.runs.find((row) => row.subAgentRunId === entry.runId);
    if (!items || !run || !matchesImportDigest(entry, items)) return null;
    return {
      importId: entry.importId,
      chatId: entry.chatId,
      sessionId: entry.sessionId,
      runId: entry.runId,
      generation: entry.generation,
      attempt: run.attempt,
      items,
      answerText: entry.answerText,
      evidenceBudgetExhausted: entry.evidenceBudgetExhausted === true,
    };
  }

  /** Records a repair attempt of an import in an epoch; false when one was already made. */
  private attempted(prepared: SubAgentPreparedImport, deliveryEpoch: number): boolean {
    for (const importId of this.reconciled.keys()) {
      if (this.importRecord(importId)?.state === "tombstoned") this.reconciled.delete(importId);
    }
    const known = this.reconciled.get(prepared.importId);
    if (known?.epochs.has(deliveryEpoch)) return false;
    if (known) known.epochs.add(deliveryEpoch);
    else
      this.reconciled.set(prepared.importId, {
        sessionId: prepared.sessionId,
        epochs: new Set([deliveryEpoch]),
      });
    return true;
  }

  private webCapacity(sessionId: string): number {
    try {
      const remaining = this.parts.sessionOptions.get(sessionId)?.grant.remainingWebCapacity?.();
      if (remaining === undefined) return Number.POSITIVE_INFINITY;
      return Number.isFinite(remaining) ? Math.max(0, Math.floor(remaining)) : 0;
    } catch {
      return 0;
    }
  }

  private findImport(
    sessionId: string,
    runId: string,
    generation: number,
  ): SubAgentImportRecord | undefined {
    return this.parts.store.state?.imports.find(
      (entry) =>
        entry.sessionId === sessionId && entry.runId === runId && entry.generation === generation,
    );
  }

  private importRecord(importId: string): SubAgentImportRecord | undefined {
    return this.parts.store.state?.imports.find((entry) => entry.importId === importId);
  }
}
