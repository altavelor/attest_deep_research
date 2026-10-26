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
  isSubAgentStateId,
  readSubAgentImportItems,
  subAgentAliasPrefix,
  toValidatedJson,
  unresolvedSubAgentCitations,
  type ImportedSubAgentEvidenceReference,
  type ImportedSubAgentRunOutcome,
  type SubAgentImportRecord,
} from "@core/research";
import { settleWithin } from "./deadline";
import { importedRunSummary, planSubAgentImport } from "./importPlan";
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
  private readonly reconciled = new Set<string>();
  committer: SubAgentImportCommitter | null = null;

  constructor(
    private readonly parts: SubAgentManagerParts,
    private readonly bridge: SubAgentEvidenceImportPort,
  ) {}

  /** Stages the prepare record of a run whose runner-completed transition was just staged. */
  prepare(sessionId: string, runId: string, result: SubAgentExecutionResult): void {
    const { store } = this.parts;
    const record = store.record(sessionId);
    const run = record?.runs.find((entry) => entry.subAgentRunId === runId);
    const generation = record?.session.pendingImportGeneration;
    if (!record || !run || !store.state || generation === null || generation === undefined) return;
    const { prepared, evidenceDigest } = planSubAgentImport({
      chatId: store.state.chatId,
      sessionId,
      runId,
      generation,
      attempt: run.attempt,
      policy: run.effectiveSourcePolicy,
      resources: this.parts.sessionOptions.get(sessionId)?.resources ?? [],
      result,
      now: timestamp(this.parts),
    });
    this.reconciled.add(`${prepared.importId}@${this.parts.context.getCurrentDeliveryEpoch()}`);
    if (this.importRecord(prepared.importId)) return;
    const entry: SubAgentImportRecord = {
      state: "prepared",
      importId: prepared.importId,
      chatId: prepared.chatId,
      sessionId,
      runId,
      evidenceDigest,
      generation,
      evidence: prepared.items.flatMap((item) => toValidatedJson(item) ?? []),
      aliases: [],
      answerText: prepared.answerText,
      createdAt: timestamp(this.parts),
    };
    store.putImport(entry);
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

  /** Stages the commit marker of an import inside the manager's import-committed barrier. */
  markCommitted(sessionId: string, runId: string, generation: number): SubAgentImportRecord | null {
    const entry = this.findImport(sessionId, runId, generation);
    if (!entry || entry.state !== "prepared") return null;
    this.parts.store.putImport({ ...entry, state: "committed" });
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
    const record = this.parts.store.record(sessionId);
    const session = record?.session;
    if (
      !session ||
      session.status !== "failed" ||
      session.pendingImportRunId !== runId ||
      session.pendingImportGeneration === null
    ) {
      return;
    }
    const generation = session.pendingImportGeneration;
    const prepared = this.pendingPrepared(sessionId, runId);
    if (!prepared) return;
    const key = `${prepared.importId}@${deliveryEpoch}`;
    if (this.reconciled.has(key)) return;
    this.reconciled.add(key);
    void this.repair(prepared, generation);
  }

  isCurrent(prepared: SubAgentPreparedImport): boolean {
    const entry = this.importRecord(prepared.importId);
    const session = this.parts.store.record(prepared.sessionId)?.session;
    return (
      entry !== undefined &&
      entry.state !== "tombstoned" &&
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
    this.parts.store.putImport({ ...entry, aliases });
    return {
      run: importedRunSummary(run, prepared.answerText),
      answerText: prepared.answerText,
      evidence: aliases,
      importId: prepared.importId,
    };
  }

  private pendingPrepared(sessionId: string, runId: string): SubAgentPreparedImport | null {
    const session = this.parts.store.record(sessionId)?.session;
    const generation = session?.pendingImportGeneration;
    if (
      !session ||
      session.pendingImportRunId !== runId ||
      generation === null ||
      generation === undefined
    )
      return null;
    const entry = this.findImport(sessionId, runId, generation);
    if (!entry || entry.state !== "prepared") return null;
    const items = readSubAgentImportItems(entry.evidence, subAgentAliasPrefix(entry.importId));
    const run = this.parts.store.record(sessionId)?.runs.find((row) => row.subAgentRunId === runId);
    if (!items || !run) return null;
    return {
      importId: entry.importId,
      chatId: entry.chatId,
      sessionId,
      runId,
      generation,
      attempt: run.attempt,
      items,
      answerText: entry.answerText,
    };
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

/**
 * Returns the bridge's aliases in item order when every admitted item got exactly one
 * alias with safe conversation IDs and its own child identity; null otherwise.
 */
function checkedAliases(
  prepared: SubAgentPreparedImport,
  registered: readonly ImportedSubAgentEvidenceReference[],
): ImportedSubAgentEvidenceReference[] | null {
  const aliases: ImportedSubAgentEvidenceReference[] = [];
  for (const item of prepared.items) {
    const alias = registered.find(
      (entry) => entry.conversationEvidenceId === item.conversationEvidenceId,
    );
    if (
      !alias ||
      !isSubAgentStateId(alias.conversationSourceId) ||
      !isSubAgentStateId(alias.conversationRevisionId)
    ) {
      return null;
    }
    aliases.push({
      conversationEvidenceId: item.conversationEvidenceId,
      conversationSourceId: alias.conversationSourceId,
      conversationRevisionId: alias.conversationRevisionId,
      subAgentEvidenceId: item.subAgentEvidenceId,
      subAgentSessionId: prepared.sessionId,
      subAgentRunId: prepared.runId,
      collectedAt: item.collectedAt,
      attempt: item.attempt,
      incomplete: item.incomplete,
    });
  }
  const known = new Set(aliases.map((alias) => alias.conversationEvidenceId));
  return unresolvedSubAgentCitations(prepared.answerText, known).length === 0 ? aliases : null;
}
