import type {
  CreateSubAgentSessionInput,
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
  SubAgentResultState,
  SubAgentRunReceipt,
  SubAgentRunRef,
  SubAgentSessionSummary,
  SubAgentSourcePolicy,
  SubAgentStateSnapshot,
  SubAgentTaskOrigin,
  ValidatedJsonValue,
} from "@core/research";

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

export interface SubAgentHost extends SubAgentLifecycle {
  delegatorFor(binding: ParentRunBinding, delivery: ParentRunDeliveryContext): SubAgentDelegator;
  subscribeResults(listener: () => void): () => void;
  listRunRefs(parentRunId: string): readonly SubAgentRunRef[];
}

export interface SubAgentDelegationGrant {
  binding: ParentRunBinding;
  callerMode: string;
  budgetPolicy: SubAgentBudgetPolicy;
  maximumSourcePolicy: SubAgentSourcePolicy;
  capturedActiveFilePath?: string;
  origin: SubAgentTaskOrigin;
  limits: { maxRounds: number; maxResultChars: number; maxSearches: number };
}

export interface SubAgentPriorContext {
  summary: string | null;
  previousResult: string | null;
  partialSummary: string | null;
  priorEvidence: readonly ImportedSubAgentEvidenceReference[];
}

export interface SubAgentExecutionEvent {
  kind: "phase";
  phase: string;
}

export interface SubAgentExecutionRequest {
  sessionId: string;
  runId: string;
  attempt: number;
  task: string;
  sourcePolicy: SubAgentSourcePolicy;
  activeFilePath?: string;
  resources: readonly string[];
  limits: { maxRounds: number; maxResultChars: number; maxSearches: number };
  priorContext: SubAgentPriorContext;
  signal: AbortSignal;
  observe(event: SubAgentExecutionEvent): void;
}

export interface SubAgentExecutionResult {
  answerText: string;
  evidence: readonly ValidatedJsonValue[];
  usage: NormalizedUsage;
  incomplete: boolean;
  terminalReason: string | null;
  telemetry: ValidatedJsonValue;
}

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

export interface SubAgentSessionManagerContext {
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
}

export type SubAgentSessionManagerFactory = (
  context: SubAgentSessionManagerContext,
) => SubAgentHost;
