import type {
  NormalizedUsage,
  SubAgentInitialPrompt,
  SubAgentModelSnapshot,
  SubAgentRunSummary,
  SubAgentSessionStatus,
  SubAgentWorkflowItem,
} from "@core/research";

export interface SubAgentSessionCard {
  sessionId: string;
  parentRunId: string;
  description: string;
  revision: number;
  status: SubAgentSessionStatus;
  model: SubAgentModelSnapshot | null;
  usage: NormalizedUsage;
  usageIncomplete: boolean;
  elapsedMs: number;
  updatedAt: string;
  canStop: boolean;
  controlRunId: string | null;
}

export interface SubAgentInspectionSnapshot {
  revision: number;
  activeCount: number;
  hasAgentRuns: boolean;
  sessions: readonly SubAgentSessionCard[];
}

export interface SubAgentRunAnswer {
  runId: string;
  text: string;
  truncated: boolean;
}

export interface SubAgentInspectionDetail {
  card: SubAgentSessionCard;
  runs: readonly SubAgentRunSummary[];
  selectedRunId: string | null;
  initialPrompts: readonly SubAgentInitialPrompt[];
  lifetime: readonly SubAgentWorkflowItem[];
  answers: readonly SubAgentRunAnswer[];
}
