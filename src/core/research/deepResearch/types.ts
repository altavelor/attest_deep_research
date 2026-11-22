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
}

export interface ResearchHistoryEntry {
  researchId: string;
  question: string;
  phase: ResearchPhase;
  terminalReason: string | null;
  createdAt: string;
  updatedAt: string;
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

export type PlanDecisionPayload =
  | { action: "approve" }
  | { action: "edit"; edit: PlanEdit }
  | { action: "regenerate"; instruction: string | null };

export type ResearchRuleResult<T> = { ok: true; value: T } | { ok: false; message: string };
