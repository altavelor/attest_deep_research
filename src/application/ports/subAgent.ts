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
  SubAgentImportItem,
  SubAgentImportRecord,
  SubAgentResultState,
  SubAgentRunReceipt,
  SubAgentRunRef,
  SubAgentSessionSummary,
  SubAgentSourcePolicy,
  SubAgentStateSnapshot,
  SubAgentTaskOrigin,
  ValidatedJsonValue,
} from "@core/research";
import type { ResearchEvidenceSnapshot } from "@application/sources/evidence";

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

export interface SubAgentPreparedImport {
  importId: string;
  chatId: string;
  sessionId: string;
  runId: string;
  generation: number;
  attempt: number;
  items: readonly SubAgentImportItem[];
  answerText: string;
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
}

export type SubAgentSessionManagerFactory = (
  context: SubAgentSessionManagerContext,
) => SubAgentHost;
