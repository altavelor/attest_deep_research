import type {
  MapSourcesRunContext,
  MapSourcesWorkerInput,
  MapSourcesWorkerPort,
  SubAgentBatchStore,
  SubAgentMainEventIntent,
} from "@application/ports";
import {
  isTerminalBatchState,
  SubAgentSessionFailure,
  subAgentSessionError,
  type MapSourcesBatchError,
  type MapSourcesBatchRecord,
  type SubAgentResultState,
  type SubAgentRunReceipt,
  type SubAgentRunRef,
  type SubAgentRunSummary,
  type SubAgentSessionErrorCode,
} from "@core/research";
import { AT } from "./subAgentSessions";

/**
 * In-memory batch records shared by any number of map_sources instances, as one chat
 * section would hold them; it logs every put with its durability and keeps terminal
 * records immutable like the manager's store.
 */
export class FakeBatchStore implements SubAgentBatchStore {
  readonly records = new Map<string, MapSourcesBatchRecord>();
  readonly puts: { state: string; durable: boolean; refs: number }[] = [];

  async load(): Promise<void> {}

  get(batchId: string): MapSourcesBatchRecord | undefined {
    return this.records.get(batchId);
  }

  batchOf(ref: SubAgentRunRef): string | null {
    for (const record of this.records.values()) {
      if (record.refs.some((entry) => entry.ref.runId === ref.runId)) return record.batchId;
    }
    return null;
  }

  pendingCount(parentRunId: string): number {
    return [...this.records.values()].filter(
      (record) => record.parentRunId === parentRunId && !isTerminalBatchState(record.state),
    ).length;
  }

  async put(record: MapSourcesBatchRecord, durable: boolean): Promise<boolean> {
    const existing = this.records.get(record.batchId);
    if (existing && isTerminalBatchState(existing.state)) return false;
    this.records.set(record.batchId, structuredClone(record));
    this.puts.push({ state: record.state, durable, refs: record.refs.length });
    return true;
  }

  async interrupt(parentRunId: string, error: MapSourcesBatchError): Promise<void> {
    for (const record of [...this.records.values()]) {
      if (record.parentRunId === parentRunId && !isTerminalBatchState(record.state)) {
        await this.put({ ...record, state: "interrupted", error }, true);
      }
    }
  }
}

/**
 * Document workers whose results the test sets per run. A start is accepted at once with
 * run ids derived from the worker request id, or rejected for a listed source path.
 */
class FakeMapWorkers implements MapSourcesWorkerPort {
  readonly inputs: MapSourcesWorkerInput[] = [];
  readonly states = new Map<string, SubAgentResultState>();
  readonly rejected = new Map<string, SubAgentSessionErrorCode>();

  async runSource(input: MapSourcesWorkerInput): Promise<SubAgentRunReceipt> {
    this.inputs.push(input);
    const code = this.rejected.get(input.sourcePath);
    if (code) throw new SubAgentSessionFailure(subAgentSessionError(code));
    const runId = `run-${input.requestId}`;
    if (!this.states.has(runId)) this.states.set(runId, workerState(runId, "pending"));
    return {
      sessionId: `session-${input.requestId}`,
      runId,
      submissionId: input.requestId,
      acceptedAt: AT,
    };
  }

  async getResult(ref: SubAgentRunRef): Promise<SubAgentResultState> {
    const state = this.states.get(ref.runId);
    if (!state) throw new SubAgentSessionFailure(subAgentSessionError("not-authorized"));
    return state;
  }

  runIdOf(sourcePath: string): string {
    const input = this.inputs.find((entry) => entry.sourcePath === sourcePath);
    return `run-${input?.requestId ?? "missing"}`;
  }
}

/** Builds a worker result state; a completed one carries the answer with an empty import. */
export function workerState(
  runId: string,
  state: SubAgentResultState["state"],
  answerOrMessage = "",
  code = "provider-failed",
  status: SubAgentRunSummary["status"] = state === "pending" ? "queued" : "completed",
): SubAgentResultState {
  const run = {
    subAgentRunId: runId,
    origin: "map_sources",
    status,
    terminalReason: null,
    usage: { requestCount: 1, modelRounds: 2, toolCalls: 1, durationMs: 7, source: "provider" },
  } as unknown as SubAgentRunSummary;
  if (state === "completed") {
    return {
      state,
      resultRevision: 1,
      outcome: { run, answerText: answerOrMessage, evidence: [], importId: `import-${runId}` },
    };
  }
  if (state === "pending") return { state, resultRevision: 0, run };
  return { state, resultRevision: 1, run, error: { code, message: answerOrMessage } };
}

/**
 * A map_sources run context over the fake store and workers with a recording notice sink
 * and a result signal the test fires; redaction replaces the word "secret".
 */
export function mapSourcesContext(
  overrides: Partial<MapSourcesRunContext> & { batches?: FakeBatchStore } = {},
) {
  const listeners = new Set<() => void>();
  const notices: SubAgentMainEventIntent[] = [];
  const workers = new FakeMapWorkers();
  const batches = overrides.batches ?? new FakeBatchStore();
  const context: MapSourcesRunContext = {
    chatId: "chat-1",
    parentRunId: "parent-1",
    workers,
    batches,
    notices: { publish: (intents) => void notices.push(...intents) },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    now: () => new Date(AT),
    redact: (text) => text.replace(/secret/giu, "[redacted]"),
    ...overrides,
  };
  return {
    context,
    workers,
    batches,
    notices,
    signal: () => [...listeners].forEach((listener) => listener()),
    listenerCount: () => listeners.size,
  };
}
