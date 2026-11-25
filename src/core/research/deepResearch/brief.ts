import { escapePromptText } from "./promptText";
import { RESEARCH_LANGUAGE_RULE, normalizeResearchLanguage } from "./researchLanguage";
import { MAX_CLARIFICATION_QUESTIONS, MAX_RESEARCH_TEXT_CHARS } from "./limits";
import type {
  ClarificationDecisionPayload,
  ClarificationQuestion,
  ResearchBrief,
  ResearchState,
} from "./types";

export const MAX_BRIEF_PROMPT_CHARS = 500;
export const MAX_BRIEF_SUGGESTION_CHARS = 200;
export const MAX_BRIEF_SUGGESTIONS = 3;
export const MAX_BRIEF_ASSUMPTIONS = 6;
export const NO_CLARIFICATION_ASSUMPTION =
  "No clarification was available; the plan follows the question as asked.";
const REPLY_PREFIX = "The user clarified: ";

export type ClarificationOutcome =
  | { kind: "ready"; assumptions: string[]; failed: boolean; language: string | null }
  | {
      kind: "questions";
      questions: ClarificationQuestion[];
      assumptions: string[];
      language: string | null;
    };

/** Builds the system prompt of the one structured clarification call before planning. */
export function clarificationPrompt(): string {
  return [
    "You decide whether a research question is clear enough to plan. Reply with one JSON object only.",
    'Shape: {"status": "ready" | "questions", "language": string, "assumptions": string[],',
    '"questions": [{"prompt": string, "suggestions": string[]}]}.',
    `Ask at most ${MAX_CLARIFICATION_QUESTIONS} questions, only when the answer changes the research.`,
    "Assumptions state what the plan assumes when the user does not answer.",
    "language is the BCP 47 tag of the language the question is written in, such as en, ru or zh-CN.",
    RESEARCH_LANGUAGE_RULE,
  ].join("\n");
}

/**
 * Reads the untrusted clarification reply. Questions get host identifiers and bounded text;
 * malformed output becomes `ready` with the explicit no-clarification assumption and is marked
 * failed, so the caller never makes a second call.
 */
export function parseClarification(text: string): ClarificationOutcome {
  const raw = firstJsonObject(text);
  const failed: ClarificationOutcome = {
    kind: "ready",
    assumptions: [NO_CLARIFICATION_ASSUMPTION],
    failed: true,
    language: null,
  };
  if (!raw || (raw.status !== "ready" && raw.status !== "questions")) return failed;
  const assumptions = boundedList(raw.assumptions, MAX_BRIEF_ASSUMPTIONS, MAX_BRIEF_PROMPT_CHARS);
  const language = normalizeResearchLanguage(raw.language);
  if (raw.status === "ready") return { kind: "ready", assumptions, failed: false, language };
  const questions = boundedClarificationQuestions(raw.questions);
  if (questions.length === 0) return failed;
  return { kind: "questions", questions, assumptions, language };
}

/**
 * Reads untrusted clarifying questions: entries without a prompt are dropped, text and
 * suggestions are trimmed and bounded, and at most the allowed number of questions get host
 * identifiers. Non-list input yields no questions.
 */
export function boundedClarificationQuestions(value: unknown): ClarificationQuestion[] {
  return (Array.isArray(value) ? value : [])
    .filter(isRecord)
    .map((entry) => ({
      prompt: bounded(entry.prompt, MAX_BRIEF_PROMPT_CHARS),
      suggestions: boundedList(
        entry.suggestions,
        MAX_BRIEF_SUGGESTIONS,
        MAX_BRIEF_SUGGESTION_CHARS,
      ),
    }))
    .filter((entry) => entry.prompt !== "")
    .slice(0, MAX_CLARIFICATION_QUESTIONS)
    .map((entry, index) => ({ questionId: `question-${index + 1}`, ...entry }));
}

/** Records the questions of the clarification round and waits for the user's clarification decision. */
export function withClarificationQuestions(
  state: ResearchState,
  outcome: Extract<ClarificationOutcome, { kind: "questions" }>,
  decisionId: string,
  now: string,
): ResearchState {
  return {
    ...state,
    revision: state.revision + 1,
    phase: "awaiting-clarification",
    pending: { decisionId, kind: "clarification", artifactRevision: 1 },
    brief: { questions: outcome.questions, answers: {}, assumptions: outcome.assumptions },
    updatedAt: now,
  };
}

/** Reads an untrusted clarification payload, or returns null when it is malformed. */
export function parseClarificationPayload(value: unknown): ClarificationDecisionPayload | null {
  if (!isRecord(value)) return null;
  if (value.action === "assume") return { action: "assume" };
  if (value.action === "reply") {
    return isAnswerText(value.text) ? { action: "reply", text: value.text } : null;
  }
  if (value.action !== "answer" || !isRecord(value.answers)) return null;
  const entries = Object.entries(value.answers);
  if (entries.length === 0 || !entries.every(([, answer]) => isAnswerText(answer))) return null;
  return { action: "answer", answers: Object.fromEntries(entries) as Record<string, string> };
}

/**
 * Applies the user's clarification to the recorded brief and returns the brief the planner
 * receives, or null when an answer addresses a question that was never asked.
 */
export function answeredBrief(
  brief: ResearchBrief,
  payload: ClarificationDecisionPayload,
): ResearchBrief | null {
  if (payload.action === "assume") return brief;
  if (payload.action === "reply") {
    return {
      ...brief,
      assumptions: [
        ...brief.assumptions.slice(0, MAX_BRIEF_ASSUMPTIONS - 1),
        `${REPLY_PREFIX}${payload.text}`.slice(0, MAX_RESEARCH_TEXT_CHARS),
      ],
    };
  }
  const asked = new Set(brief.questions.map((question) => question.questionId));
  if (!Object.keys(payload.answers).every((questionId) => asked.has(questionId))) return null;
  return { ...brief, answers: { ...payload.answers } };
}

/** Builds the brief that ends the clarification round without questions. */
export function readyBrief(assumptions: readonly string[]): ResearchBrief {
  return { questions: [], answers: {}, assumptions: [...assumptions] };
}

/** Renders the brief as the planner's context: answered questions first, then assumptions. */
export function briefText(brief: ResearchBrief | null): string {
  if (!brief) return "";
  const answered = brief.questions.flatMap((question) => {
    const answer = brief.answers[question.questionId];
    return answer ? [`- ${escapePromptText(question.prompt)} → ${escapePromptText(answer)}`] : [];
  });
  const assumptions = brief.assumptions.map((assumption) => `- ${escapePromptText(assumption)}`);
  return [
    answered.length > 0 ? `Clarified by the user:\n${answered.join("\n")}` : "",
    assumptions.length > 0 ? `Assumptions:\n${assumptions.join("\n")}` : "",
  ]
    .filter((part) => part !== "")
    .join("\n\n");
}

function isAnswerText(value: unknown): value is string {
  return (
    typeof value === "string" && value.trim() !== "" && value.length <= MAX_RESEARCH_TEXT_CHARS
  );
}

function boundedList(value: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => bounded(entry, maxChars)))]
    .filter((entry) => entry !== "")
    .slice(0, maxItems);
}

function bounded(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function firstJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const value: unknown = JSON.parse(text.slice(start, end + 1));
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
