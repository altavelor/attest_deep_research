import type { ResearchLimits, ResearchPhase, ResearchPreset } from "./types";

export const DEEP_RESEARCH_SCHEMA = 1;
export const MAX_RESEARCH_BRANCHES = 8;
export const MAX_PLAN_GENERATIONS = 3;
export const MAX_CLARIFICATION_ROUNDS = 1;
export const MAX_CLARIFICATION_QUESTIONS = 3;
export const MAX_RESEARCH_NOTES = 50;
export const MAX_BRANCH_FINDING_CHARS = 30_000;
export const MAX_BRANCH_FINDING_BYTES = 48 * 1024;
export const MAX_FINDING_CITATION_TOKENS = 200;
export const MAX_RESEARCH_SECTION_BYTES = 1024 * 1024;
export const MAX_RESEARCH_HISTORY = 10;
export const MAX_HISTORY_QUESTION_CHARS = 1000;
export const MAX_PLAN_LIST_ITEMS = 12;
export const MAX_RESEARCH_QUESTION_CHARS = 20_000;
export const MAX_RESEARCH_TEXT_CHARS = 4000;
export const MAX_DISCOVERY_TEXT_CHARS = 200;
export const DEFAULT_RESEARCH_PRESET: ResearchPreset = "balanced";

const MINUTE_MS = 60_000;

export const RESEARCH_PRESET_LIMITS: Readonly<Record<ResearchPreset, Readonly<ResearchLimits>>> = {
  conservative: {
    branches: 3,
    childSessions: 2,
    attemptsPerBranch: 2,
    attemptsTotal: 5,
    modelRoundsPerAttempt: 12,
    modelRoundsTotal: 80,
    finalizationReserveRounds: 10,
    searchesTotal: 30,
    evidenceItemsTotal: 60,
    researchCycles: 1,
    verificationFollowUps: 1,
    activeExecutionMs: 15 * MINUTE_MS,
  },
  balanced: {
    branches: 6,
    childSessions: 4,
    attemptsPerBranch: 2,
    attemptsTotal: 10,
    modelRoundsPerAttempt: 12,
    modelRoundsTotal: 160,
    finalizationReserveRounds: 16,
    searchesTotal: 60,
    evidenceItemsTotal: 120,
    researchCycles: 2,
    verificationFollowUps: 1,
    activeExecutionMs: 30 * MINUTE_MS,
  },
  thorough: {
    branches: 8,
    childSessions: 5,
    attemptsPerBranch: 3,
    attemptsTotal: 16,
    modelRoundsPerAttempt: 12,
    modelRoundsTotal: 280,
    finalizationReserveRounds: 24,
    searchesTotal: 100,
    evidenceItemsTotal: 200,
    researchCycles: 3,
    verificationFollowUps: 2,
    activeExecutionMs: 60 * MINUTE_MS,
  },
};

const TERMINAL_PHASES: readonly ResearchPhase[] = ["completed", "failed", "cancelled"];

/** Tells whether a research phase ends the research. */
export function isTerminalResearchPhase(phase: ResearchPhase): boolean {
  return TERMINAL_PHASES.includes(phase);
}

/** Returns a fresh copy of the limits row of a preset. */
export function presetLimits(preset: ResearchPreset): ResearchLimits {
  return { ...RESEARCH_PRESET_LIMITS[preset] };
}
