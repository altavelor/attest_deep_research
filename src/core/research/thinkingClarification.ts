import type {
  AnswerClarification,
  AnswerClarificationQuestion,
  ClarificationReply,
} from "@core/answer";
import {
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
 * bounds. Input without a single usable question is rejected so the model can retry or answer.
 */
export function parseClarificationArguments(
  input: Record<string, unknown>,
): ClarificationArguments {
  const questions = boundedClarificationQuestions(input.questions);
  if (questions.length === 0) {
    return {
      ok: false,
      message: `Pass 1-${MAX_CLARIFICATION_QUESTIONS} questions, each with a non-empty prompt.`,
    };
  }
  return { ok: true, clarification: { questions } };
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
