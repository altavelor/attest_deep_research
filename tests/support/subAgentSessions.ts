import type {
  SubAgentDelegationGrant,
  SubAgentDelegator,
  SubAgentDurableWriter,
  SubAgentEvidenceImportPort,
  SubAgentExecutionPort,
  SubAgentExecutionRequest,
  SubAgentExecutionResult,
  SubAgentImportRequest,
  SubAgentImportResult,
  SubAgentSessionManagerContext,
} from "@application/ports";
import { createSubAgentSessionManager } from "@application/use-cases/sub-agent";
import {
  applySubAgentTransition,
  type ParentRunBinding,
  type SubAgentBufferedValue,
  type SubAgentCommand,
  type SubAgentRunReceipt,
  type SubAgentRunSummary,
  type SubAgentSessionRecord,
  type SubAgentSessionSummary,
  type SubAgentSourcePolicy,
  type SubAgentStateSnapshot,
  type SubAgentTransition,
} from "@core/research";

export const AT = "2026-10-26T10:00:00.000Z";

export function sourcePolicy(overrides: Partial<SubAgentSourcePolicy> = {}): SubAgentSourcePolicy {
  return {
    searchMode: "indexAndWeb",
    contextPaths: ["Research"],
    indexScope: "paths",
    allowActiveFile: true,
    allowNoteMutation: false,
    ...overrides,
  };
}

/** Builds a fresh ready sub-agent session record with no runs. */
export function readySubAgentRecord(sessionId = "session-1"): SubAgentSessionRecord {
  return {
    session: {
      subAgentSessionId: sessionId,
      createRequestId: `create-${sessionId}`,
      chatSessionId: "chat-1",
      parentRunId: "parent-1",
      bindingGeneration: 1,
      status: "ready",
      title: "Task",
      sourcePolicy: sourcePolicy(),
      budgetPolicy: { type: "required-scope", scopeId: "scope-1" },
      activeSubAgentRunId: null,
      pendingImportRunId: null,
      pendingImportGeneration: null,
      lastImportGeneration: 0,
      runCount: 0,
      revision: 0,
      contextSummary: null,
      evidenceRegistryId: `evidence-${sessionId}`,
      createdAt: AT,
      updatedAt: AT,
    },
    runs: [],
  };
}

/** Applies transitions in order and fails loudly on the first rejected one. */
export function applyAll(
  record: SubAgentSessionRecord,
  transitions: readonly SubAgentTransition[],
): SubAgentSessionRecord {
  return transitions.reduce((current, transition) => {
    const result = applySubAgentTransition(current, transition);
    if (!result.ok) throw new Error(`${transition.type} rejected: ${result.error.code}`);
    return result.record;
  }, record);
}

/** Lists the transitions that queue, start and finish a run up to the importing state. */
export function runToImport(
  runId: string,
  command: SubAgentCommand = { type: "initial", task: "Find X" },
): SubAgentTransition[] {
  return [
    {
      type: "command",
      command,
      origin: "direct",
      runId,
      at: AT,
      callerMode: "thinking",
    },
    { type: "scheduler-start", runId, at: AT },
    {
      type: "runner-completed",
      runId,
      at: AT,
      usage: { requestCount: 1, modelRounds: 1, toolCalls: 2, durationMs: 5, source: "provider" },
      evidenceCount: 2,
      resultSummary: `summary of ${runId}`,
    },
  ];
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

/** Returns a promise with its settle functions, used as a gate instead of timing. */
export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

/**
 * Durable writer fake that records every staged delta. Flushes succeed at once unless
 * the test queues a failure or holds them until released; a held flush may never end.
 */
class FakeSubAgentWriter implements SubAgentDurableWriter {
  readonly deltas: SubAgentBufferedValue[] = [];
  flushes = 0;
  private failures: Error[] = [];
  private gates: Promise<void>[] = [];

  failNext(error: Error): void {
    this.failures.push(error);
  }

  holdNext(): () => void {
    const gate = deferred<void>();
    this.gates.push(gate.promise);
    return () => gate.resolve();
  }

  markDirty(_key: string, _revision: number, payload: SubAgentBufferedValue): "accepted" {
    this.deltas.push(payload);
    return "accepted";
  }

  async flushThrough(): Promise<void> {
    this.flushes += 1;
    const gate = this.gates.shift();
    const failure = this.failures.shift();
    if (gate) await gate;
    if (failure) throw failure;
  }
}

/** Builds a finished runner result with the given answer and one evidence item. */
export function executionResult(answerText = "Child answer"): SubAgentExecutionResult {
  return {
    answerText,
    evidence: [{ id: "evidence-1" }],
    usage: { requestCount: 1, modelRounds: 1, toolCalls: 1, durationMs: 3, source: "provider" },
    incomplete: false,
    terminalReason: null,
    telemetry: null,
  };
}

/** Execution port fake: every run waits until the test finishes or fails it by index. */
export class FakeSubAgentExecution implements SubAgentExecutionPort {
  readonly requests: SubAgentExecutionRequest[] = [];
  private readonly runs: Deferred<SubAgentExecutionResult>[] = [];

  run(request: SubAgentExecutionRequest): Promise<SubAgentExecutionResult> {
    this.requests.push(request);
    const run = deferred<SubAgentExecutionResult>();
    this.runs.push(run);
    return run.promise;
  }

  finish(index: number, result = executionResult()): void {
    this.runs[index].resolve(result);
  }

  fail(index: number): void {
    this.runs[index].reject(new Error("provider exploded with secret details"));
  }
}

/** Import port fake that commits at once by default, or holds or fails the next commits. */
export class FakeSubAgentImport implements SubAgentEvidenceImportPort {
  readonly requests: SubAgentImportRequest[] = [];
  mode: "commit" | "hold" | "fail" = "commit";
  private readonly held: Deferred<void>[] = [];

  async commit(request: SubAgentImportRequest): Promise<SubAgentImportResult> {
    this.requests.push(request);
    if (this.mode === "hold") {
      const gate = deferred<void>();
      this.held.push(gate);
      await gate.promise;
    }
    if (this.mode === "fail") throw new Error("import failed");
    return {
      outcome: {
        run: { subAgentRunId: request.runId } as SubAgentRunSummary,
        answerText: request.result.answerText,
        evidence: [],
        importId: `import-${request.runId}`,
      },
    };
  }

  release(): void {
    this.mode = "commit";
    for (const gate of this.held.splice(0)) gate.resolve();
  }
}

/** Builds a Thinking delegation grant with a local budget for the binding. */
export function delegationGrant(
  binding: ParentRunBinding,
  overrides: Partial<SubAgentDelegationGrant> = {},
): SubAgentDelegationGrant {
  return {
    binding,
    callerMode: "thinking",
    budgetPolicy: { type: "local" },
    maximumSourcePolicy: sourcePolicy(),
    capturedActiveFilePath: "Research/Active.md",
    origin: "direct",
    limits: { maxRounds: 6, maxResultChars: 4000, maxSearches: 5 },
    ...overrides,
  };
}

export interface ManagerHarnessOptions {
  chatId?: string | null;
  load?: () => Promise<SubAgentStateSnapshot | null>;
}

/**
 * Builds a session manager over fake ports for one chat whose current parent run is
 * parent-1 generation 1 with grant-1. The test can move the parent binding or the
 * delivery epoch and register further grants.
 */
export function managerHarness(options: ManagerHarnessOptions = {}) {
  const chatId = options.chatId === undefined ? "chat-1" : options.chatId;
  const binding: ParentRunBinding = {
    chatSessionId: chatId ?? "chat-1",
    parentRunId: "parent-1",
    bindingGeneration: 1,
  };
  const writer = new FakeSubAgentWriter();
  const execution = new FakeSubAgentExecution();
  const imports = new FakeSubAgentImport();
  const grants = new Map([["grant-1", delegationGrant(binding)]]);
  const probes = { parent: binding as ParentRunBinding | null, epoch: 1 };
  let sequence = 0;
  const context: SubAgentSessionManagerContext = {
    getChatId: () => chatId,
    repository: { load: options.load ?? (async () => null) },
    writer,
    execution,
    evidenceImport: imports,
    getCurrentParentBinding: () => probes.parent,
    getCurrentDeliveryEpoch: () => probes.epoch,
    resolveGrant: (id) => grants.get(id) ?? null,
    now: () => new Date(AT),
    createId: (prefix) => `${prefix}-${chatId ?? "draft"}-${(sequence += 1)}`,
  };
  const manager = createSubAgentSessionManager(context);
  const delegator = (grantId = "grant-1", deliveryEpoch = 1) =>
    manager.delegatorFor(binding, { deliveryEpoch, grantId });
  return { manager, binding, writer, execution, imports, grants, probes, delegator };
}

/** Creates a session through the delegator and submits its initial command. */
export async function launchChild(
  delegator: SubAgentDelegator,
  name: string,
  task = `Investigate ${name}`,
): Promise<{ session: SubAgentSessionSummary; receipt: SubAgentRunReceipt }> {
  const session = await delegator.create({ createRequestId: `create-${name}`, title: task });
  const receipt = await delegator.run(
    session.subAgentSessionId,
    { type: "initial", task },
    `submit-${name}`,
  );
  return { session, receipt };
}
