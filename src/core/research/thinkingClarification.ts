import type {
  AnswerClarification,
  AnswerClarificationQuestion,
  ClarificationReply,
} from "@core/answer";
import {
  MAX_BRIEF_PROMPT_CHARS,
  MAX_BRIEF_SUGGESTION_CHARS,
  MAX_BRIEF_SUGGESTIONS,
  MAX_CLARIFICATION_QUESTIONS,
  MAX_RESEARCH_TEXT_CHARS,
  boundedClarificationQuestions,
  readClarificationQuestion,
} from "./deepResearch";

export interface ClarificationReplyLabels {
  heading: string;
  answer: string;
  unanswered: string;
}

export type ClarificationArguments =
  { ok: true; clarification: AnswerClarification } | { ok: false; message: string };

/**
 * Reads the untrusted arguments of the Thinking clarification tool with the Deep Research brief
 * bounds. Any invalid entry, an empty list or too many questions rejects the whole call so the
 * model can retry or answer.
 */
export function parseClarificationArguments(
  input: Record<string, unknown>,
): ClarificationArguments {
  const questions = input.questions;
  if (
    !Array.isArray(questions) ||
    questions.length === 0 ||
    questions.length > MAX_CLARIFICATION_QUESTIONS ||
    !questions.every(isValidQuestionArgument)
  ) {
    return {
      ok: false,
      message:
        `Pass 1-${MAX_CLARIFICATION_QUESTIONS} questions, each with a non-empty prompt of at most ` +
        `${MAX_BRIEF_PROMPT_CHARS} characters and at most ${MAX_BRIEF_SUGGESTIONS} string ` +
        `suggestions of at most ${MAX_BRIEF_SUGGESTION_CHARS} characters.`,
    };
  }
  return { ok: true, clarification: { questions: boundedClarificationQuestions(questions) } };
}

/** Tells whether one tool argument entry is a question with a bounded prompt and suggestions. */
function isValidQuestionArgument(entry: unknown): boolean {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false;
  const { prompt, suggestions } = entry as { prompt?: unknown; suggestions?: unknown };
  if (typeof prompt !== "string" || prompt.trim() === "") return false;
  if (prompt.trim().length > MAX_BRIEF_PROMPT_CHARS) return false;
  if (suggestions === undefined) return true;
  return (
    Array.isArray(suggestions) &&
    suggestions.length <= MAX_BRIEF_SUGGESTIONS &&
    suggestions.every(
      (suggestion) =>
        typeof suggestion === "string" && suggestion.trim().length <= MAX_BRIEF_SUGGESTION_CHARS,
    )
  );
}

/** Reads a stored clarification, or returns undefined when it is absent or malformed. */
export function readAnswerClarification(value: unknown): AnswerClarification | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const questions: unknown = (value as { questions?: unknown }).questions;
  if (
    !Array.isArray(questions) ||
    questions.length === 0 ||
    questions.length > MAX_CLARIFICATION_QUESTIONS
  ) {
    return undefined;
  }
  const read = questions.map(readClarificationQuestion);
  if (read.includes(undefined)) return undefined;
  if (new Set(read.map((question) => question!.questionId)).size !== read.length) return undefined;
  return { questions: read as AnswerClarificationQuestion[] };
}

/** Keeps the trimmed, bounded, non-empty answers to the asked questions as a structured reply. */
export function clarificationReplyOf(
  clarification: AnswerClarification,
  answers: Readonly<Record<string, string>>,
): ClarificationReply {
  const kept: Record<string, string> = {};
  for (const { questionId } of clarification.questions) {
    const answer = (answers[questionId] ?? "").trim().slice(0, MAX_RESEARCH_TEXT_CHARS);
    if (answer) kept[questionId] = answer;
  }
  return { answers: kept, skipped: false };
}

/** Formats a structured reply as the chat message text the model reads, marking unanswered questions. */
export function formatClarificationReply(
  clarification: AnswerClarification,
  reply: ClarificationReply,
  labels: ClarificationReplyLabels,
): string {
  const items = clarification.questions.map(
    (question, index) =>
      `${index + 1}. ${question.prompt}\n${labels.answer}: ` +
      (reply.answers[question.questionId] ?? labels.unanswered),
  );
  return [labels.heading, ...items].join("\n\n");
}

/** Reads a stored clarification reply, or returns undefined when it is absent or malformed. */
export function readClarificationReply(value: unknown): ClarificationReply | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { answers, skipped } = value as { answers?: unknown; skipped?: unknown };
  if (typeof skipped !== "boolean" || typeof answers !== "object" || answers === null) {
    return undefined;
  }
  const entries = Object.entries(answers);
  if (entries.length > MAX_CLARIFICATION_QUESTIONS) return undefined;
  const valid = entries.every(
    ([, answer]) =>
      typeof answer === "string" &&
      answer.trim() !== "" &&
      answer.length <= MAX_RESEARCH_TEXT_CHARS,
  );
  return valid
    ? { answers: Object.fromEntries(entries) as Record<string, string>, skipped }
    : undefined;
}

/** Renders the asked questions for the next turn's chat history. */
export function clarificationHistoryText(clarification: AnswerClarification): string {
  return [
    "Clarifying questions asked instead of answering:",
    ...clarification.questions.map((question, index) => `${index + 1}. ${question.prompt}`),
  ].join("\n");
}
