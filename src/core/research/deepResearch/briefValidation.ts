import { MAX_CLARIFICATION_QUESTIONS, MAX_RESEARCH_TEXT_CHARS } from "./limits";
import {
  MAX_BRIEF_ASSUMPTIONS,
  MAX_BRIEF_PROMPT_CHARS,
  MAX_BRIEF_SUGGESTION_CHARS,
  MAX_BRIEF_SUGGESTIONS,
} from "./brief";
import {
  MAX_CLAIM_QUOTE_CHARS,
  MAX_CLAIM_TEXT_CHARS,
  MAX_CLAIM_TOKENS,
  MAX_RESEARCH_CLAIMS,
  objectiveCoverage,
} from "./verification";
import { isResearchId, isRevision } from "./planValidation";
import { readExecutions } from "./executionValidation";
import type {
  BranchExecution,
  ClaimAssessment,
  ClarificationQuestion,
  ResearchBrief,
  ResearchClaim,
  ResearchPlan,
  ResearchVerification,
} from "./types";

const VERDICTS: readonly ClaimAssessment["verdict"][] = [
  "supported",
  "unsupported",
  "conflicted",
  "unresolved",
];
const MAX_TOKEN_CHARS = 200;
const MAX_GROUP_CHARS = 16;
const MAX_VERIFIED_WORKS = 16;
const MAX_FOLLOW_UPS = 2;

/** Reads a stored research brief; a section written before briefs existed has none. */
export function readBrief(value: unknown): ResearchBrief | null | undefined {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || !Array.isArray(value.questions) || !isRecord(value.answers)) return;
  const questions = value.questions.map(readClarificationQuestion);
  const ids = new Set(questions.map((question) => question?.questionId));
  const answers = Object.entries(value.answers);
  if (
    questions.length > MAX_CLARIFICATION_QUESTIONS ||
    questions.includes(undefined) ||
    ids.size !== questions.length ||
    !answers.every(([id, answer]) => ids.has(id) && isText(answer, MAX_RESEARCH_TEXT_CHARS)) ||
    !isTextList(value.assumptions, MAX_BRIEF_ASSUMPTIONS, MAX_RESEARCH_TEXT_CHARS)
  ) {
    return undefined;
  }
  return {
    questions: questions as ClarificationQuestion[],
    answers: Object.fromEntries(answers) as Record<string, string>,
    assumptions: [...value.assumptions],
  };
}

/**
 * Reads the stored verification of an approved plan, or returns undefined when any field is
 * malformed, names a branch, objective, claim or work the research does not have, or stores a
 * coverage that differs from the one its claims and assessments give.
 */
export function readVerification(
  value: unknown,
  plan: ResearchPlan | null,
  executions: readonly BranchExecution[],
): ResearchVerification | null | undefined {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || !plan?.approvedAt) return undefined;
  const claims = Array.isArray(value.claims) ? value.claims.map((c) => readClaim(c, plan)) : null;
  const assessments = Array.isArray(value.assessments)
    ? value.assessments.map(readAssessment)
    : null;
  const followUps = readExecutions(value.followUps);
  if (!claims || claims.length > MAX_RESEARCH_CLAIMS || claims.includes(undefined)) return;
  const claimIds = new Set(claims.map((claim) => claim!.claimId));
  if (
    claimIds.size !== claims.length ||
    !assessments ||
    assessments.includes(undefined) ||
    new Set(assessments.map((entry) => entry?.claimId)).size !== assessments.length ||
    !assessments.every((entry) => claimIds.has(entry!.claimId)) ||
    !Array.isArray(value.coverage) ||
    !value.coverage.every(
      (entry) =>
        isRecord(entry) &&
        plan.objectives.includes(entry.objective as string) &&
        typeof entry.covered === "boolean",
    ) ||
    value.coverage.length > plan.objectives.length ||
    !Array.isArray(value.verifiedWorks) ||
    value.verifiedWorks.length > MAX_VERIFIED_WORKS ||
    !value.verifiedWorks.every(isResearchId) ||
    !followUps ||
    followUps.length > MAX_FOLLOW_UPS ||
    !isRevision(value.followUpsUsed) ||
    value.followUpsUsed > plan.limits.verificationFollowUps ||
    followUps.length > value.followUpsUsed
  ) {
    return undefined;
  }
  const works = new Set([...executions, ...followUps].map((execution) => execution.workId));
  const coverage = objectiveCoverage(
    plan.objectives,
    claims as ResearchClaim[],
    assessments as ClaimAssessment[],
  );
  if (
    !value.verifiedWorks.every((workId) => works.has(workId as string)) ||
    !claims.every((claim) => works.has(claim!.workId)) ||
    JSON.stringify(coverage) !== JSON.stringify(value.coverage)
  ) {
    return undefined;
  }
  return {
    claims: claims as ResearchClaim[],
    assessments: assessments as ClaimAssessment[],
    coverage: value.coverage.map((entry) => ({
      objective: (entry as Record<string, string>).objective!,
      covered: (entry as Record<string, boolean>).covered!,
    })),
    verifiedWorks: [...(value.verifiedWorks as string[])],
    followUps,
    followUpsUsed: value.followUpsUsed,
  };
}

/** Reads one stored clarifying question, or returns undefined when any field is out of bounds. */
export function readClarificationQuestion(value: unknown): ClarificationQuestion | undefined {
  if (
    !isRecord(value) ||
    !isResearchId(value.questionId) ||
    !isText(value.prompt, MAX_BRIEF_PROMPT_CHARS) ||
    !isTextList(value.suggestions, MAX_BRIEF_SUGGESTIONS, MAX_BRIEF_SUGGESTION_CHARS)
  ) {
    return undefined;
  }
  return {
    questionId: value.questionId,
    prompt: value.prompt,
    suggestions: [...value.suggestions],
  };
}

function readClaim(value: unknown, plan: ResearchPlan): ResearchClaim | undefined {
  if (
    !isRecord(value) ||
    !isResearchId(value.claimId) ||
    !isResearchId(value.workId) ||
    !plan.branches.some((branch) => branch.branchId === value.branchId) ||
    !(
      value.objective === null ||
      plan.branches.some(
        (branch) =>
          branch.branchId === value.branchId &&
          branch.objectives.includes(value.objective as string),
      )
    ) ||
    !isText(value.text, MAX_CLAIM_TEXT_CHARS) ||
    !isTextList(value.citationTokens, MAX_CLAIM_TOKENS, MAX_TOKEN_CHARS) ||
    !(value.kind === undefined || value.kind === "hypothesis")
  ) {
    return undefined;
  }
  return {
    claimId: value.claimId,
    workId: value.workId,
    branchId: value.branchId as string,
    objective: value.objective as string | null,
    text: value.text,
    citationTokens: [...value.citationTokens],
    ...(value.kind === "hypothesis" ? { kind: value.kind } : {}),
  };
}

function readAssessment(value: unknown): ClaimAssessment | undefined {
  if (
    !isRecord(value) ||
    !isResearchId(value.claimId) ||
    !VERDICTS.includes(value.verdict as ClaimAssessment["verdict"]) ||
    !(value.verdict === "supported"
      ? isText(value.quote, MAX_CLAIM_QUOTE_CHARS)
      : value.quote === null) ||
    !isTextList(value.contradictingTokens, MAX_CLAIM_TOKENS, MAX_TOKEN_CHARS) ||
    !isTextList(value.independenceGroups, MAX_CLAIM_TOKENS, MAX_GROUP_CHARS)
  ) {
    return undefined;
  }
  return {
    claimId: value.claimId,
    verdict: value.verdict as ClaimAssessment["verdict"],
    quote: value.quote as string | null,
    contradictingTokens: [...value.contradictingTokens],
    independenceGroups: [...value.independenceGroups],
  };
}

function isTextList(value: unknown, maxItems: number, maxChars: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maxItems &&
    value.every((entry) => isText(entry, maxChars))
  );
}

function isText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
