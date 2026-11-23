import type {
  CreateSubAgentSessionInput,
  MapSourcesBatchError,
  MapSourcesBatchRecord,
  ImportedSubAgentEvidenceReference,
  ImportedSubAgentRunOutcome,
  NormalizedUsage,
  ParentRunBinding,
  ParentRunDeliveryContext,
  RetrySubAgentCommand,
  SubAgentBudgetPolicy,
  SubAgentBufferedValue,
  SubAgentCommand,
  SubAgentFlushReason,
  SubAgentImportItem,
  SubAgentDispatchEntry,
  SubAgentEvidenceTool,
  SubAgentImportRecord,
  SubAgentNoticeEntry,
  SubAgentObservationEvent,
  SubAgentResultState,
  SubAgentRunReceipt,
  SubAgentRunRef,
  SubAgentSessionSummary,
  SubAgentSourcePolicy,
  SubAgentStateSnapshot,
  SubAgentTaskOrigin,
  ValidatedJsonValue,
  SubAgentPromptSession,
} from "@core/research";
import type { ResearchEvidenceSnapshot } from "@application/sources/evidence";
import type { SourceReference } from "@core/model";
import type { BranchAllocation, ResearchBranch } from "@core/research/deepResearch";
import type {
  SubAgentInspectionDetail,
  SubAgentInspectionSnapshot,
} from "@application/contracts/subAgentInspection";

export interface SubAgentSessionRepository {
  load(chatId: string): Promise<SubAgentStateSnapshot | null>;
}

export interface SubAgentDurableWriter {
  markDirty(key: string, revision: number, payload: SubAgentBufferedValue): "accepted" | "full";
  flushThrough(revision: number, reason: SubAgentFlushReason): Promise<void>;
}

export interface SubAgentWaitOptions {
  mode: "any" | "all";
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface SubAgentWaitResult {
  ready: readonly SubAgentRunRef[];
  timedOut: boolean;
}

export interface SubAgentDelegator {
  create(input: CreateSubAgentSessionInput): Promise<SubAgentSessionSummary>;
  getCreatedSession(createRequestId: string): Promise<SubAgentSessionSummary>;
  run(
    sessionId: string,
    command: Extract<SubAgentCommand, { type: "initial" }>,
    submissionId: string,
  ): Promise<SubAgentRunReceipt>;
  continue(
    sessionId: string,
    command: Exclude<SubAgentCommand, { type: "initial" }>,
    submissionId: string,
  ): Promise<SubAgentRunReceipt>;
  retry(
    sessionId: string,
    command: RetrySubAgentCommand,
    submissionId: string,
  ): Promise<SubAgentRunReceipt>;
  getResult(sessionId: string, runId: string): Promise<SubAgentResultState>;
  waitForResults(
    refs: readonly SubAgentRunRef[],
    options: SubAgentWaitOptions,
  ): Promise<SubAgentWaitResult>;
  stop(sessionId: string): Promise<void>;
}

export interface SubAgentCloseResult {
  durable: boolean;
  recoveryMarkerPersisted: boolean;
  unsettledPermits: number;
  failures: readonly string[];
}

export interface SubAgentLifecycle {
  closeAll(parentRunId: string, terminalReason: string): Promise<SubAgentCloseResult>;
  dispose(): Promise<void>;
}

export type SubAgentUserStopResult = "stopped" | "already-terminal" | "stale";

/**
 * Read and stop-only capability of one chat's child sessions for the UI. It never hands
 * out the manager, a delegator or a grant; a stop names the run the user saw.
 */
export interface SubAgentInspectionPort {
  snapshot(): Promise<SubAgentInspectionSnapshot>;
  getSession(sessionId: string): Promise<SubAgentInspectionDetail | null>;
  subscribe(listener: (snapshot: SubAgentInspectionSnapshot) => void): () => void;
  stopFromUser(sessionId: string, expectedRunId: string | null): Promise<SubAgentUserStopResult>;
}

export interface SubAgentHost extends SubAgentLifecycle {
  delegatorFor(binding: ParentRunBinding, delivery: ParentRunDeliveryContext): SubAgentDelegator;
  subscribeResults(listener: () => void): () => void;
  listRunRefs(parentRunId: string): readonly SubAgentRunRef[];
  inspection(): SubAgentInspectionPort;
  importLookup?(): SubAgentImportLookup;
  batches?(): SubAgentBatchStore;
  promptSessions?(): Promise<readonly SubAgentPromptSession[]>;
}

/**
 * The map_sources batches of one chat's sub-agent section. A put stages the record and,
 * when durable, waits for its write; a terminal record is never replaced, which the put
 * reports as false.
 */
export interface SubAgentBatchStore {
  load(): Promise<void>;
  get(batchId: string): MapSourcesBatchRecord | undefined;
  batchOf(ref: SubAgentRunRef): string | null;
  pendingCount(parentRunId: string): number;
  put(record: MapSourcesBatchRecord, durable: boolean): Promise<boolean>;
  interrupt(parentRunId: string, error: MapSourcesBatchError): Promise<void>;
}

export type SubAgentTerminalResult = Exclude<SubAgentResultState, { state: "pending" }>;

export interface SubAgentDeliveredResult {
  ref: SubAgentRunRef;
  result: SubAgentTerminalResult;
}

/**
 * Parent-side delivery of child results at model round boundaries and the completion
 * barrier that keeps a final answer from being published while children are pending.
 */
export interface SubAgentParentCoordinatorPort {
  beforeModelRound(): Promise<readonly SubAgentDeliveredResult[]>;
  acknowledgeResults(results: readonly { ref: SubAgentRunRef; resultRevision: number }[]): void;
  beforeFinalize(signal?: AbortSignal): Promise<"ready" | "resume-with-results">;
}

/**
 * What one parent run hands to its research strategy for delegated work: the results
 * coordinator, the evidence resolver of committed imports, and hooks that bind the
 * run's child execution and its evidence registry capacity.
 */
export interface SubAgentParentRun {
  parentRunId: string;
  coordinator: SubAgentParentCoordinatorPort;
  resolver: SubAgentImportedEvidenceResolver;
  bindExecution(execution: SubAgentExecutionPort): void;
  attachEvidence(capacity: { remainingWebCapacity?(): number }): void;
  listSessions?(): Promise<readonly SubAgentPromptSession[]>;
}

export type SubAgentMainEventIntent =
  | { type: "dispatch"; entry: Omit<SubAgentDispatchEntry, "sequence"> }
  | { type: "notice"; entry: Omit<SubAgentNoticeEntry, "sequence"> };

/**
 * Receives the main-visible dispatch and notice intents of lifecycle transitions off the
 * manager lock; the chat side allocates their sequence and stores them idempotently by eventKey.
 */
export interface SubAgentMainEventSink {
  publish(intents: readonly SubAgentMainEventIntent[]): void;
}

export interface SubAgentDelegationGrant {
  binding: ParentRunBinding;
  callerMode: string;
  budgetPolicy: SubAgentBudgetPolicy;
  maximumSourcePolicy: SubAgentSourcePolicy;
  capturedActiveFilePath?: string;
  origin: SubAgentTaskOrigin;
  limits: { maxRounds: number; maxResultChars: number; maxSearches: number };
  remainingWebCapacity?(): number;
}

export interface SubAgentPriorEvidenceItem {
  id: string;
  source: SourceReference;
  text: string;
  tool: SubAgentEvidenceTool;
  collectedAt: string;
}

export interface SubAgentPriorContext {
  summary: string | null;
  previousResult: string | null;
  partialSummary: string | null;
  continuesPartial: boolean;
  priorEvidence: readonly ImportedSubAgentEvidenceReference[];
  priorEvidenceItems: readonly SubAgentPriorEvidenceItem[];
}

export interface SubAgentExecutionEvent {
  kind: "phase";
  phase: string;
}

export interface SubAgentExecutionRequest {
  sessionId: string;
  runId: string;
  origin?: SubAgentTaskOrigin;
  attempt: number;
  task: string;
  sourcePolicy: SubAgentSourcePolicy;
  activeFilePath?: string;
  resources: readonly string[];
  limits: { maxRounds: number; maxResultChars: number; maxSearches: number };
  priorContext: SubAgentPriorContext;
  signal: AbortSignal;
  observe(event: SubAgentExecutionEvent): void;
  onObservation(event: SubAgentObservationEvent): void;
}

export interface SubAgentExecutionResult {
  answerText: string;
  evidence: readonly ValidatedJsonValue[];
  usage: NormalizedUsage;
  incomplete: boolean;
  terminalReason: string | null;
  telemetry: ValidatedJsonValue;
}

/**
 * Runs one child command. A continue-partial run must return the evidence it keeps from
 * the interrupted run, at least its resolved prior evidence items, in its own result
 * evidence, because the manager stores only references of committed imports.
 */
export interface SubAgentExecutionPort {
  run(request: SubAgentExecutionRequest): Promise<SubAgentExecutionResult>;
}

export interface SubAgentImportRequest {
  sessionId: string;
  runId: string;
  result: SubAgentExecutionResult;
}

export interface SubAgentImportResult {
  outcome: ImportedSubAgentRunOutcome;
}

export interface SubAgentEvidenceImportPort {
  commit(request: SubAgentImportRequest): Promise<SubAgentImportResult>;
}

export interface SubAgentPreparedImport {
  importId: string;
  chatId: string;
  sessionId: string;
  runId: string;
  generation: number;
  attempt: number;
  items: readonly SubAgentImportItem[];
  answerText: string;
  evidenceBudgetExhausted: boolean;
  repairOnly?: boolean;
}

export interface SubAgentPreparedImportRequest extends SubAgentImportRequest {
  prepared: SubAgentPreparedImport;
}

export interface SubAgentImportedEvidenceResolver {
  resolve(outcome: ImportedSubAgentRunOutcome): Promise<ResearchEvidenceSnapshot>;
}

export interface SubAgentImportLookup {
  isCurrent(prepared: SubAgentPreparedImport): boolean;
  committed(outcome: ImportedSubAgentRunOutcome): SubAgentImportRecord | null;
}

export type SubAgentBudgetUnit =
  | "branchAttempts"
  | "modelRounds"
  | "searches"
  | "fetches"
  | "evidenceItems"
  | "documentReads"
  | "verificationFollowUps"
  | "inputTokens"
  | "outputTokens";

export interface SubAgentBudgetRequest {
  actionKey: string;
  action: "model-round" | "search" | "fetch" | "evidence-append";
  units: Partial<Readonly<Record<SubAgentBudgetUnit, number>>>;
}

export interface SubAgentBudgetPermit {
  permitId: string;
  scopeId: string;
  actionKey: string;
}

export interface SubAgentBudgetRegistration {
  registrationId: string;
  scopeId: string;
  creationKey: string;
  generation: number;
}

export type SubAgentBudgetClosureReason =
  { type: "exhausted"; dimension: SubAgentBudgetUnit } | { type: "deadline" };

export type SubAgentBudgetRegistrationResult =
  | { type: "registered"; registration: SubAgentBudgetRegistration }
  | {
      type: "denied";
      closureId: string;
      creationKey: string;
      closedAt: string;
      reason: SubAgentBudgetClosureReason;
    };

export type SubAgentBudgetRegistrationFinishResult =
  | { type: "accepted" }
  | { type: "closed"; closureId: string; closedAt: string; reason: SubAgentBudgetClosureReason };

export type SubAgentBudgetReserveResult =
  | { type: "granted"; permit: SubAgentBudgetPermit }
  | {
      type: "work-denied";
      denialId: string;
      actionKey: string;
      reason: "per-work-attempt-limit";
    }
  | {
      type: "denied";
      closureId: string;
      actionKey: string;
      closedAt: string;
      reason: SubAgentBudgetClosureReason;
    };

export interface SubAgentBudgetPermitPort {
  beginSessionRegistration(
    scopeId: string,
    creationKey: string,
  ): Promise<SubAgentBudgetRegistrationResult>;
  finishSessionRegistration(
    registration: SubAgentBudgetRegistration,
    outcome: { type: "published"; sessionId: string } | { type: "aborted" },
  ): Promise<SubAgentBudgetRegistrationFinishResult>;
  beginExecution(scopeId: string, actionKey: string): Promise<SubAgentBudgetReserveResult>;
  reserve(scopeId: string, request: SubAgentBudgetRequest): Promise<SubAgentBudgetReserveResult>;
  markStarted(permit: SubAgentBudgetPermit): Promise<void>;
  settle(permit: SubAgentBudgetPermit, outcome: "consumed" | "not-started"): Promise<void>;
  claimClosureCleanup(scopeId: string, closureId: string): Promise<boolean>;
}

export interface SubAgentSessionManagerContext {
  budget?: SubAgentBudgetPermitPort;
  getChatId(): string | null;
  repository: SubAgentSessionRepository;
  writer: SubAgentDurableWriter;
  execution: SubAgentExecutionPort;
  evidenceImport: SubAgentEvidenceImportPort;
  getCurrentParentBinding(): ParentRunBinding | null;
  getCurrentDeliveryEpoch(): number;
  resolveGrant(id: string): SubAgentDelegationGrant | null;
  now(): Date;
  createId(prefix: string): string;
  redact(text: string, key?: string): string;
  monotonicNow?(): number;
  isDebugCapture?(): boolean;
  mainEvents?: SubAgentMainEventSink;
}

export type SubAgentSessionManagerFactory = (
  context: SubAgentSessionManagerContext,
) => SubAgentHost;

/**
 * What a Deep Research turn gets from its chat for delegated branches: a delegator per branch
 * attempt bound to that branch's budget scope, and the hook that attaches the research's permit
 * port to the chat manager's budget router for the turn.
 */
export interface ResearchSubAgentContext {
  delegator(branch: ResearchBranch, allocation: BranchAllocation): SubAgentDelegator;
  attachBudget(port: SubAgentBudgetPermitPort & { readonly researchId: string }): () => void;
}
