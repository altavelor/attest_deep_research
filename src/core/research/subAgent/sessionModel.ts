import type { ResearchMode } from "../researchMode";
import type { ResearchSearchMode } from "../searchMode";
import type { SubAgentModelSnapshot } from "./modelSnapshot";
import type { SubAgentTaskOrigin } from "./validation";

export type SubAgentSessionStatus =
  "ready" | "queued" | "running" | "importing" | "stopping" | "failed" | "interrupted" | "archived";

export type SubAgentRunStatus =
  "queued" | "running" | "stopping" | "completed" | "failed" | "interrupted";

export type SubAgentIndexScope = "none" | "all-allowed" | "paths";

export interface SubAgentSourcePolicy {
  searchMode: ResearchSearchMode;
  contextPaths: readonly string[];
  indexScope: SubAgentIndexScope;
  allowActiveFile: boolean;
  allowNoteMutation: false;
}

export interface SubAgentScopeReduction {
  searchMode?: Exclude<ResearchSearchMode, "indexAndWeb">;
  contextPaths: readonly string[];
  allowActiveFile: false;
}

export type SubAgentBudgetPolicy = { type: "local" } | { type: "required-scope"; scopeId: string };

export interface NormalizedUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
  requestCount: number;
  modelRounds: number;
  toolCalls: number;
  durationMs: number;
  source: "provider" | "estimated" | "unavailable";
}

export interface SubAgentSessionSummary {
  subAgentSessionId: string;
  createRequestId: string;
  chatSessionId: string;
  parentRunId: string;
  bindingGeneration: number;
  status: SubAgentSessionStatus;
  title: string;
  sourcePolicy: SubAgentSourcePolicy;
  budgetPolicy: SubAgentBudgetPolicy;
  activeSubAgentRunId: string | null;
  pendingImportRunId: string | null;
  pendingImportGeneration: number | null;
  lastImportGeneration: number;
  runCount: number;
  revision: number;
  contextSummary: string | null;
  evidenceRegistryId: string;
  createdAt: string;
  updatedAt: string;
  resources?: readonly string[];
  maxSearches?: number;
}

export interface SubAgentRunSummary {
  subAgentRunId: string;
  subAgentSessionId: string;
  parentRunId: string;
  callerMode: ResearchMode;
  command: string;
  origin: SubAgentTaskOrigin;
  attempt: number;
  resultRevision: number;
  status: SubAgentRunStatus;
  phase: string | null;
  startedAt: string | null;
  completedAt: string | null;
  evidenceCount: number;
  usage: NormalizedUsage;
  terminalReason: string | null;
  resultSummary: string | null;
  effectiveSourcePolicy: SubAgentSourcePolicy;
  retryOfRunId: string | null;
  continuedFromRunId: string | null;
  budgetScopeId: string | null;
  model?: SubAgentModelSnapshot;
}

export interface SubAgentSessionRecord {
  session: SubAgentSessionSummary;
  runs: readonly SubAgentRunSummary[];
}

export interface ParentRunBinding {
  chatSessionId: string;
  parentRunId: string;
  bindingGeneration: number;
}

export interface ParentRunDeliveryContext {
  deliveryEpoch: number;
  grantId: string;
}

export interface SubAgentCreateRecord {
  createRequestId: string;
  normalizedInputDigest: string;
  candidateSessionId: string;
  status: "pending" | "published" | "denied";
  publishedSessionId: string | null;
  terminalReason: string | null;
}

export interface CreateSubAgentSessionInput {
  createRequestId: string;
  title: string;
  maxSearches?: number;
  resources?: readonly string[];
  scopeReduction?: SubAgentScopeReduction;
}

export type SubAgentCommand =
  | { type: "initial"; task: string }
  | { type: "follow-up"; task: string; scopeReduction?: SubAgentScopeReduction }
  | {
      type: "continue-partial";
      task: string;
      fromRunId: string;
      scopeReduction?: SubAgentScopeReduction;
    };

export interface RetrySubAgentCommand {
  runId: string;
  scopeReduction?: SubAgentScopeReduction;
}

export interface SubAgentRunRef {
  sessionId: string;
  runId: string;
}

export interface SubAgentRunReceipt {
  sessionId: string;
  runId: string;
  submissionId: string;
  acceptedAt: string;
}

export interface SubAgentSubmissionRecord {
  submissionId: string;
  sessionId: string;
  normalizedCommandDigest: string;
  runId: string;
  receipt: SubAgentRunReceipt;
}

export interface ImportedSubAgentEvidenceReference {
  conversationEvidenceId: string;
  conversationSourceId: string;
  conversationRevisionId: string;
  subAgentEvidenceId: string;
  subAgentSessionId: string;
  subAgentRunId: string;
  collectedAt: string;
  attempt: number;
  incomplete: boolean;
}

export interface ImportedSubAgentRunOutcome {
  run: SubAgentRunSummary;
  answerText: string;
  evidence: readonly ImportedSubAgentEvidenceReference[];
  importId: string;
  evidenceBudgetExhausted?: boolean;
}

export interface SubAgentResultError {
  code: string;
  message: string;
}

export type SubAgentResultState =
  | {
      state: "pending";
      resultRevision: number;
      run: SubAgentRunSummary;
      importError?: SubAgentResultError;
    }
  | { state: "completed"; resultRevision: number; outcome: ImportedSubAgentRunOutcome }
  | {
      state: "failed" | "interrupted";
      resultRevision: number;
      run: SubAgentRunSummary;
      error: SubAgentResultError;
    };
