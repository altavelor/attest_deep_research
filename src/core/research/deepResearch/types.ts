import type {
  ResearchCycle,
  ResearchHypothesis,
  ResearchNote,
  ResearchObservation,
  ResearchTest,
} from "./discoveryTypes";

export type ResearchPhase =
  | "planning"
  | "awaiting-approval"
  | "gathering"
  | "verifying"
  | "synthesizing"
  | "awaiting-clarification"
  | "discovering"
  | "awaiting-observation"
  | "completed"
  | "failed"
  | "cancelled";

export type ResearchPreset = "conservative" | "balanced" | "thorough";

export interface ResearchLimits {
  branches: number;
  childSessions: number;
  attemptsPerBranch: number;
  attemptsTotal: number;
  modelRoundsPerAttempt: number;
  modelRoundsTotal: number;
  finalizationReserveRounds: number;
  searchesTotal: number;
  evidenceItemsTotal: number;
  researchCycles: number;
  verificationFollowUps: number;
  activeExecutionMs: number;
}

export interface PendingDecision {
  decisionId: string;
  kind: "plan" | "clarification" | "observation" | "stale-plan";
  artifactRevision: number;
}

export interface ResearchDecision {
  researchId: string;
  decisionId: string;
  expectedRevision: number;
  payload: unknown;
}

export type ResearchTurnInput =
  | { type: "start" }
  | { type: "decision"; decision: ResearchDecision }
  | { type: "continue"; researchId: string }
  | { type: "cancel"; researchId: string };

export type ResearchSourceScope = "indexOnly" | "webOnly" | "indexAndWeb";

export interface ResearchBranch {
  branchId: string;
  title: string;
  task: string;
  expectedOutput: string;
  priority: "required" | "optional";
  enabled: boolean;
  objectives: readonly string[];
  sourceScope: ResearchSourceScope;
  dependsOn: readonly string[];
}

export interface ResearchPlan {
  planId: string;
  revision: number;
  objectives: readonly string[];
  reportOutline: readonly string[];
  branches: readonly ResearchBranch[];
  knownOmissions: readonly string[];
  preset: ResearchPreset;
  limits: ResearchLimits;
  generationsUsed: number;
  approvedAt: string | null;
}

export interface ResearchState {
  schema: number;
  researchId: string;
  revision: number;
  question: string;
  phase: ResearchPhase;
  pending: PendingDecision | null;
  plan: ResearchPlan | null;
  terminalReason: string | null;
  createdAt: string;
  updatedAt: string;
  budget: ResearchBudgetState | null;
  executions: readonly BranchExecution[];
  sessionByBranch: Readonly<Record<string, string>>;
  report: ResearchReport | null;
  brief: ResearchBrief | null;
  verification: ResearchVerification | null;
  discovery: ResearchDiscovery | null;
}

export interface ClarificationQuestion {
  questionId: string;
  prompt: string;
  suggestions: readonly string[];
}

export interface ResearchBrief {
  questions: readonly ClarificationQuestion[];
  answers: Readonly<Record<string, string>>;
  assumptions: readonly string[];
}

export type ClarificationDecisionPayload =
  | { action: "answer"; answers: Readonly<Record<string, string>> }
  | { action: "assume" }
  | { action: "reply"; text: string };

export interface ResearchClaim {
  claimId: string;
  workId: string;
  branchId: string;
  objective: string | null;
  text: string;
  citationTokens: readonly string[];
  kind?: "hypothesis";
}

export type ClaimVerdict = "supported" | "unsupported" | "conflicted" | "unresolved";

export interface ClaimAssessment {
  claimId: string;
  verdict: ClaimVerdict;
  quote: string | null;
  contradictingTokens: readonly string[];
  independenceGroups: readonly string[];
}

export interface ObjectiveCoverage {
  objective: string;
  covered: boolean;
}

export interface VerificationSummary {
  claims: readonly ResearchClaim[];
  assessments: readonly ClaimAssessment[];
  coverage: readonly ObjectiveCoverage[];
  followUps: readonly ResearchWork[];
}

export interface ResearchVerification {
  claims: readonly ResearchClaim[];
  assessments: readonly ClaimAssessment[];
  coverage: readonly ObjectiveCoverage[];
  verifiedWorks: readonly string[];
  followUps: readonly BranchExecution[];
  followUpsUsed: number;
}

export interface ReportVerificationCounts {
  supported: number;
  conflicted: number;
  unsupported: number;
  unresolved: number;
  uncoveredObjectives: readonly string[];
}

export type BudgetDimension = "branchAttempts" | "modelRounds" | "searches" | "evidenceItems";

export interface ResearchBudgetState {
  consumed: Readonly<Record<BudgetDimension, number>>;
  attemptsByBranch: Readonly<Record<string, number>>;
  activeMs: number;
  openAllocations: readonly BranchAllocation[];
  closed: { reason: "exhausted" | "time" | "user"; dimension: string | null } | null;
  diagnostics: { inputTokens: number | null; outputTokens: number | null; fetches: number };
}

export interface BranchAllocation {
  workId: string;
  branchId: string;
  attempt: number;
  modelRounds: number;
  searches: number;
}

export interface ResearchWork {
  workId: string;
  branchId: string;
  cycle: number;
  kind: "gather" | "follow-up" | "test";
  task: string;
}

export type BranchExecutionState =
  "pending" | "running" | "completed" | "failed" | "skipped" | "blocked";

export interface BranchExecution {
  workId: string;
  branchId: string;
  state: BranchExecutionState;
  path: "main" | "sub-agent" | null;
  attempts: number;
  finding: BranchFinding | null;
  terminalReason: string | null;
  runRef?: BranchRunRef;
}

export interface BranchRunRef {
  sessionId: string;
  runId: string;
  resultRevision: number;
}

export interface BranchFinding {
  text: string;
  citationTokens: readonly string[];
  partial: boolean;
}

export interface ResearchReport {
  reportId: string;
  quality: "complete" | "partial";
  markdown: string;
  completedBranches: readonly string[];
  missingBranches: readonly { branchId: string; reason: string }[];
  stopReason: string;
  createdAt: string;
  verification: ReportVerificationCounts | null;
}

export type ResearchReportSummary = Omit<ResearchReport, "markdown">;

export interface ResearchHistoryEntry {
  researchId: string;
  question: string;
  phase: ResearchPhase;
  terminalReason: string | null;
  createdAt: string;
  updatedAt: string;
  report: ResearchReportSummary | null;
}

export interface DeepResearchSection {
  schema: number;
  active: ResearchState | null;
  history: readonly ResearchHistoryEntry[];
}

export type ResearchSectionView =
  | { status: "ready"; active: ResearchState | null; history: readonly ResearchHistoryEntry[] }
  | { status: "unreadable"; reason: string };

export interface ResearchArtifactReference {
  researchId: string;
  artifact: "plan";
  revision: number;
}

export interface PlanBranchEdit {
  branchId: string;
  title?: string;
  task?: string;
  enabled?: boolean;
}

export interface PlanEdit {
  branches?: readonly PlanBranchEdit[];
  knownOmissions?: readonly string[];
}

export type StalePlanDecisionPayload = { action: "continue" | "replan" | "cancel" };

export type PlanDecisionPayload =
  | { action: "approve" }
  | { action: "edit"; edit: PlanEdit }
  | { action: "regenerate"; instruction: string | null };

export type ResearchRuleResult<T> = { ok: true; value: T } | { ok: false; message: string };

export interface ResearchDiscovery {
  hypotheses: readonly ResearchHypothesis[];
  tests: readonly ResearchTest[];
  observations: readonly ResearchObservation[];
  cycles: readonly ResearchCycle[];
  notes: readonly ResearchNote[];
  executions: readonly BranchExecution[];
  omissions: readonly string[];
}
