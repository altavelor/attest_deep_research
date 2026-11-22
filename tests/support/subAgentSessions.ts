import type {
  SubAgentBudgetClosureReason,
  SubAgentBudgetPermit,
  SubAgentBudgetPermitPort,
  SubAgentBudgetRegistration,
  SubAgentBudgetRegistrationFinishResult,
  SubAgentBudgetRegistrationResult,
  SubAgentBudgetRequest,
  SubAgentBudgetReserveResult,
  SubAgentDelegationGrant,
  SubAgentDelegator,
  SubAgentDurableWriter,
  SubAgentEvidenceImportPort,
  SubAgentExecutionPort,
  SubAgentExecutionRequest,
  SubAgentExecutionResult,
  SubAgentImportRequest,
  SubAgentImportResult,
  SubAgentImportLookup,
  SubAgentMainEventIntent,
  SubAgentParentRun,
  SubAgentSessionManagerContext,
} from "@application/ports";
import type { ResearchEvidenceSnapshot } from "@application/sources/evidence";
import {
  ChatSubAgentEvidenceBridge,
  type ChatSubAgentEvidenceBridgeContext,
} from "@application/use-cases/chat";
import {
  createConversationSourceRegistry,
  type ConversationSourceRegistry,
} from "@core/chat/sourceRegistry";
import {
  createSubAgentSessionManager,
  type SubAgentSessionManager,
} from "@application/use-cases/sub-agent";
import type { SubAgentManagerParts } from "@application/use-cases/sub-agent/managerParts";
import { ParentFences } from "@application/use-cases/sub-agent/parentFences";
import { SubAgentBudgetCoordinator } from "@application/use-cases/sub-agent/subAgentBudget";
import { SubAgentStateStore } from "@application/use-cases/sub-agent/SubAgentStateStore";
import {
  applySubAgentTransition,
  type MapSourcesBatchRecord,
  type ParentRunBinding,
  type SubAgentBufferedValue,
  type SubAgentCommand,
  type SubAgentResultState,
  type SubAgentRunReceipt,
  type SubAgentRunSummary,
  type SubAgentSessionRecord,
  type SubAgentSessionSummary,
  type SubAgentSourcePolicy,
  type SubAgentStateSnapshot,
  type SubAgentTransition,
  type ValidatedJsonValue,
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

/** Builds a stored map_sources batch of parent-1 over one document mapped by run-1 of session-1. */
export function batchRecord(overrides: Partial<MapSourcesBatchRecord> = {}): MapSourcesBatchRecord {
  return {
    batchId: "batch-1",
    parentRunId: "parent-1",
    requestId: "parent-1-r1-call",
    normalizedInputDigest: "digest-1",
    question: "Does X hold?",
    createdAt: AT,
    selection: "explicit",
    sourcePaths: ["Notes/a.md"],
    refs: [{ sourcePath: "Notes/a.md", ref: { sessionId: "session-1", runId: "run-1" } }],
    state: "pending",
    ...overrides,
  };
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
 * A test may also report the buffer full for the next staged deltas.
 */
class FakeSubAgentWriter implements SubAgentDurableWriter {
  readonly deltas: SubAgentBufferedValue[] = [];
  flushes = 0;
  fullDeltas = 0;
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

  markDirty(_key: string, _revision: number, payload: SubAgentBufferedValue): "accepted" | "full" {
    if (this.fullDeltas > 0) {
      this.fullDeltas -= 1;
      return "full";
    }
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

type BudgetMethod = keyof SubAgentBudgetPermitPort;

interface FakeScope {
  closure: { closureId: string; closedAt: string; reason: SubAgentBudgetClosureReason } | null;
  generation: number;
  registrations: Set<string>;
  executionsLeft: number;
  claimed: boolean;
}

/**
 * Scope owner fake of the budget permit port: permits are single-use and idempotent per
 * action key, settlement keeps its first outcome, a sealed scope gives one stable closure
 * and the cleanup claim is a compare-and-set. Any method can be held or failed per call.
 */
export class FakeBudgetOwner implements SubAgentBudgetPermitPort {
  readonly calls: string[] = [];
  readonly permits = new Map<string, SubAgentBudgetPermit>();
  readonly started = new Set<string>();
  readonly settlements = new Map<string, "consumed" | "not-started">();
  readonly deniedWork = new Set<string>();
  private readonly scopes = new Map<string, FakeScope>();
  private readonly held = new Map<BudgetMethod, Deferred<void>[]>();
  private readonly failing = new Map<BudgetMethod, number>();

  scope(scopeId: string): FakeScope {
    const existing = this.scopes.get(scopeId);
    if (existing) return existing;
    const created: FakeScope = {
      closure: null,
      generation: 1,
      registrations: new Set(),
      executionsLeft: Infinity,
      claimed: false,
    };
    this.scopes.set(scopeId, created);
    return created;
  }

  seal(scopeId: string): void {
    const scope = this.scope(scopeId);
    scope.closure ??= {
      closureId: `closure-${scopeId}`,
      closedAt: AT,
      reason: { type: "exhausted", dimension: "branchAttempts" },
    };
  }

  hold(method: BudgetMethod): () => void {
    const gate = deferred<void>();
    this.held.set(method, [...(this.held.get(method) ?? []), gate]);
    return () => gate.resolve();
  }

  failNext(method: BudgetMethod, times = 1): void {
    this.failing.set(method, times);
  }

  async beginSessionRegistration(
    scopeId: string,
    creationKey: string,
  ): Promise<SubAgentBudgetRegistrationResult> {
    const scope = this.scope(scopeId);
    const closure = scope.closure;
    if (!closure) scope.registrations.add(creationKey);
    await this.enter("beginSessionRegistration", creationKey);
    if (closure) return { type: "denied", creationKey, ...closure };
    const registration = { registrationId: `reg-${creationKey}`, scopeId, creationKey };
    return { type: "registered", registration: { ...registration, generation: scope.generation } };
  }

  async finishSessionRegistration(
    registration: SubAgentBudgetRegistration,
    outcome: { type: "published"; sessionId: string } | { type: "aborted" },
  ): Promise<SubAgentBudgetRegistrationFinishResult> {
    await this.enter("finishSessionRegistration", `${registration.creationKey}:${outcome.type}`);
    const scope = this.scope(registration.scopeId);
    scope.registrations.delete(registration.creationKey);
    if (scope.closure && outcome.type === "published") return { type: "closed", ...scope.closure };
    return { type: "accepted" };
  }

  async beginExecution(scopeId: string, actionKey: string): Promise<SubAgentBudgetReserveResult> {
    await this.enter("beginExecution", actionKey);
    const scope = this.scope(scopeId);
    const fresh = !this.permits.has(actionKey);
    if (fresh && scope.executionsLeft <= 0) this.seal(scopeId);
    const result = this.grant(scopeId, actionKey);
    if (result.type === "granted" && fresh) scope.executionsLeft -= 1;
    return result;
  }

  async reserve(
    scopeId: string,
    request: SubAgentBudgetRequest,
  ): Promise<SubAgentBudgetReserveResult> {
    await this.enter("reserve", request.actionKey);
    return this.grant(scopeId, request.actionKey);
  }

  async markStarted(permit: SubAgentBudgetPermit): Promise<void> {
    await this.enter("markStarted", permit.actionKey);
    this.started.add(permit.actionKey);
  }

  async settle(permit: SubAgentBudgetPermit, outcome: "consumed" | "not-started"): Promise<void> {
    await this.enter("settle", `${permit.actionKey}:${outcome}`);
    if (!this.settlements.has(permit.permitId)) this.settlements.set(permit.permitId, outcome);
  }

  async claimClosureCleanup(scopeId: string, closureId: string): Promise<boolean> {
    await this.enter("claimClosureCleanup", closureId);
    const scope = this.scope(scopeId);
    if (scope.claimed || scope.closure?.closureId !== closureId) return false;
    scope.claimed = true;
    return true;
  }

  consumed(): number {
    return [...this.settlements.values()].filter((outcome) => outcome === "consumed").length;
  }

  private grant(scopeId: string, actionKey: string): SubAgentBudgetReserveResult {
    const scope = this.scope(scopeId);
    if (this.deniedWork.has(actionKey)) {
      return {
        type: "work-denied",
        denialId: `denial-${actionKey}`,
        actionKey,
        reason: "per-work-attempt-limit",
      };
    }
    if (scope.closure && !this.permits.has(actionKey)) {
      return { type: "denied", actionKey, ...scope.closure };
    }
    const permit = this.permits.get(actionKey) ?? {
      permitId: `permit-${actionKey}`,
      scopeId,
      actionKey,
    };
    this.permits.set(actionKey, permit);
    return { type: "granted", permit };
  }

  private async enter(method: BudgetMethod, detail: string): Promise<void> {
    this.calls.push(`${method}:${detail}`);
    const gate = this.held.get(method)?.shift();
    if (gate) await gate.promise;
    const failures = this.failing.get(method) ?? 0;
    if (failures > 0) {
      this.failing.set(method, failures - 1);
      throw new Error(`${method} unavailable`);
    }
  }
}

/** Builds a delegation grant bound to a required-scope budget of the given scope. */
export function scopedGrant(
  binding: ParentRunBinding,
  scopeId = "scope-1",
): SubAgentDelegationGrant {
  return delegationGrant(binding, {
    callerMode: "deep-research",
    budgetPolicy: { type: "required-scope", scopeId },
  });
}

export interface ManagerHarnessOptions {
  chatId?: string | null;
  load?: () => Promise<SubAgentStateSnapshot | null>;
  budget?: FakeBudgetOwner;
  evidenceImport?: SubAgentEvidenceImportPort;
  redact?: (text: string) => string;
  execution?: SubAgentExecutionPort;
}

/** Builds one untrusted child evidence value as the runner reports it, web by default. */
export function childEvidence(
  id: string,
  overrides: Record<string, ValidatedJsonValue> = {},
): ValidatedJsonValue {
  return {
    id,
    source: { kind: "web", url: `https://example.com/${id}`, title: `Title ${id}` },
    text: `Text of ${id}`,
    tool: "search_web",
    query: "q",
    ...overrides,
  };
}

/**
 * The chat side of the evidence bridge: one in-memory conversation registry, a serializer
 * that runs work in order and a durable save that succeeds unless failed or held.
 */
export class FakeChatRegistry {
  registry: ConversationSourceRegistry = createConversationSourceRegistry();
  readonly saved: ConversationSourceRegistry[] = [];
  attempts = 0;
  private failures: Error[] = [];
  private gates: Deferred<void>[] = [];
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly save?: (registry: ConversationSourceRegistry) => Promise<unknown>) {}

  failNext(error: Error): void {
    this.failures.push(error);
  }

  holdNext(): () => void {
    const gate = deferred<void>();
    this.gates.push(gate);
    return () => gate.resolve();
  }

  context(lookup: () => SubAgentImportLookup | null): ChatSubAgentEvidenceBridgeContext {
    return {
      lookup,
      serialize: <T>(work: () => Promise<T>): Promise<T> => {
        const next = this.tail.then(work, work);
        this.tail = next.catch(() => undefined);
        return next;
      },
      readRegistry: () => this.registry,
      writeRegistry: (registry) => (this.registry = registry),
      saveRegistry: async (registry) => {
        this.attempts += 1;
        const gate = this.gates.shift();
        if (gate) await gate.promise;
        const failure = this.failures.shift();
        if (failure) throw failure;
        await this.save?.(registry);
        this.saved.push(registry);
      },
    };
  }
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
  const probes = {
    parent: binding as ParentRunBinding | null,
    epoch: 1,
    debug: false,
    clockMs: 0,
    now: AT,
  };
  const mainEvents: SubAgentMainEventIntent[] = [];
  let sequence = 0;
  const context: SubAgentSessionManagerContext = {
    getChatId: () => chatId,
    repository: { load: options.load ?? (async () => null) },
    writer,
    execution: options.execution ?? execution,
    evidenceImport: options.evidenceImport ?? imports,
    ...(options.budget ? { budget: options.budget } : {}),
    getCurrentParentBinding: () => probes.parent,
    getCurrentDeliveryEpoch: () => probes.epoch,
    resolveGrant: (id) => grants.get(id) ?? null,
    now: () => new Date(probes.now),
    createId: (prefix) => `${prefix}-${chatId ?? "draft"}-${(sequence += 1)}`,
    redact: options.redact ?? ((text) => text),
    monotonicNow: () => probes.clockMs,
    isDebugCapture: () => probes.debug,
    mainEvents: { publish: (intents) => void mainEvents.push(...intents) },
  };
  const manager = createSubAgentSessionManager(context);
  const delegator = (grantId = "grant-1", deliveryEpoch = 1) =>
    manager.delegatorFor(binding, { deliveryEpoch, grantId });
  return { manager, binding, writer, execution, imports, grants, probes, delegator, mainEvents };
}

/**
 * Moves the harness to a later parent run of the same chat: a new binding generation,
 * delivery epoch and registered grant. Returns the binding and its delegator.
 */
export function nextParentRun(
  harness: ReturnType<typeof managerHarness>,
  parentRunId = "parent-2",
  generation = 2,
) {
  const binding = { ...harness.binding, parentRunId, bindingGeneration: generation };
  harness.probes.parent = binding;
  harness.probes.epoch = generation;
  harness.grants.set(`grant-${parentRunId}`, delegationGrant(binding));
  const delegator = harness.manager.delegatorFor(binding, {
    deliveryEpoch: generation,
    grantId: `grant-${parentRunId}`,
  });
  return { binding, delegator };
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

/**
 * Builds a budget coordinator over the fake owner and a store loaded from the snapshot,
 * as the manager wires it; reloading means building a second one from the first's state.
 */
export async function budgetCoordinator(owner: FakeBudgetOwner, snapshot: SubAgentStateSnapshot) {
  const writer = new FakeSubAgentWriter();
  const store = new SubAgentStateStore({
    getChatId: () => snapshot.chatId,
    repository: { load: async () => snapshot },
    writer,
  });
  await store.load();
  const fences = new ParentFences();
  const coordinator = new SubAgentBudgetCoordinator({ context: { budget: owner }, store, fences });
  return { coordinator, store, fences };
}

/**
 * Builds a manager harness whose import port is the real chat evidence bridge over a fake
 * chat registry, wired to the manager's own import lookup as the composition root does.
 */
export function importHarness(
  options: ManagerHarnessOptions & {
    save?: (registry: ConversationSourceRegistry) => Promise<unknown>;
  } = {},
) {
  const chat = new FakeChatRegistry(options.save);
  let lookup: SubAgentImportLookup | null = null;
  const bridge = new ChatSubAgentEvidenceBridge(chat.context(() => lookup));
  const harness = managerHarness({ ...options, evidenceImport: bridge });
  lookup = (harness.manager as SubAgentSessionManager).importLookup();
  return { ...harness, chat, bridge };
}

/** Returns the manager's internal parts, so a white-box test can stage a record as storage would. */
export function managerParts(manager: unknown): SubAgentManagerParts {
  return (manager as { parts: SubAgentManagerParts }).parts;
}

/**
 * A delegator that accepts every command at once and records each call with its
 * arguments; results come from the states the test queues per run.
 */
export function recordingDelegator(results: Record<string, SubAgentResultState> = {}) {
  const calls: { method: string; args: unknown[] }[] = [];
  const receipt = (sessionId: string, submissionId: string): SubAgentRunReceipt => ({
    sessionId,
    runId: `run-of-${submissionId}`,
    submissionId,
    acceptedAt: AT,
  });
  const delegator = {
    create: async (...args: unknown[]) => {
      calls.push({ method: "create", args });
      const input = args[0] as { createRequestId: string };
      return { subAgentSessionId: `session-of-${input.createRequestId}` };
    },
    run: async (sessionId: string, ...rest: unknown[]) => {
      calls.push({ method: "run", args: [sessionId, ...rest] });
      return receipt(sessionId, rest[1] as string);
    },
    continue: async (sessionId: string, ...rest: unknown[]) => {
      calls.push({ method: "continue", args: [sessionId, ...rest] });
      return receipt(sessionId, rest[1] as string);
    },
    retry: async (sessionId: string, ...rest: unknown[]) => {
      calls.push({ method: "retry", args: [sessionId, ...rest] });
      return receipt(sessionId, rest[1] as string);
    },
    getResult: async (sessionId: string, runId: string) => {
      calls.push({ method: "getResult", args: [sessionId, runId] });
      const state = results[runId];
      if (!state) throw new Error(`No result for ${runId}.`);
      return state;
    },
  } as unknown as SubAgentDelegator;
  return { delegator, calls };
}

/** A parent run whose resolver returns the given snapshot and which records attached capacity. */
export function fakeParentRun(
  snapshot: ResearchEvidenceSnapshot = { evidence: [], citations: [], provenance: [] },
  parentRunId = "parent-1",
) {
  const attached: { remainingWebCapacity?(): number }[] = [];
  const parent: SubAgentParentRun = {
    parentRunId,
    coordinator: {
      beforeModelRound: async () => [],
      acknowledgeResults: () => undefined,
      beforeFinalize: async () => "ready",
    },
    resolver: { resolve: async () => snapshot },
    bindExecution: () => undefined,
    attachEvidence: (capacity) => void attached.push(capacity),
  };
  return { parent, attached };
}

/**
 * A child host and delegator over result states the test sets per run. A read returns
 * the state current when it started; onRead may then change states and signal.
 */
export function resultBoard(parentRunId = "parent-1") {
  const states = new Map<string, SubAgentResultState>();
  const listeners = new Set<() => void>();
  const closed: string[] = [];
  const reads: string[] = [];
  const unreadable = new Set<string>();
  const refs = () =>
    [...states.keys(), ...unreadable].map((runId) => ({ sessionId: `s-${runId}`, runId }));
  const board = {
    closed,
    unreadable,
    closeFailure: null as Error | null,
    reads,
    onRead: (_runId: string): void => undefined,
    host: {
      subscribeResults: (listener: () => void) => {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
      listRunRefs: (id: string) => (id === parentRunId ? refs() : []),
      closeAll: async (_id: string, reason: string) => {
        closed.push(reason);
        if (board.closeFailure) throw board.closeFailure;
        return { durable: true, recoveryMarkerPersisted: false, unsettledPermits: 0, failures: [] };
      },
    },
    delegator: {
      getResult: async (_sessionId: string, runId: string) => {
        reads.push(runId);
        if (unreadable.has(runId)) throw new Error("Unreadable result.");
        const state = states.get(runId)!;
        board.onRead(runId);
        return state;
      },
    },
    set(
      runId: string,
      state: SubAgentResultState["state"],
      resultRevision = 1,
      code = "x",
      origin = "direct",
    ): void {
      const run = { status: state, origin } as unknown as SubAgentRunSummary;
      states.set(
        runId,
        state === "completed"
          ? {
              state,
              resultRevision,
              outcome: { run, answerText: "A", evidence: [], importId: "i" },
            }
          : state === "pending"
            ? { state, resultRevision, run }
            : { state, resultRevision, run, error: { code, message: code } },
      );
    },
    signal(): void {
      for (const listener of [...listeners]) listener();
    },
    listenerCount: () => listeners.size,
  };
  return board;
}
