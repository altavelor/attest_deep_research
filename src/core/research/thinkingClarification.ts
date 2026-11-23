import type { AnswerClarification, AnswerClarificationQuestion } from "@core/answer";
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

/** Formats the user's answers as one ordinary chat message, marking unanswered questions. */
export function formatClarificationReply(
  clarification: AnswerClarification,
  answers: Readonly<Record<string, string>>,
  labels: ClarificationReplyLabels,
): string {
  const items = clarification.questions.map((question, index) => {
    const answer = (answers[question.questionId] ?? "").trim().slice(0, MAX_RESEARCH_TEXT_CHARS);
    return `${replyHeader(index, question, labels)}${answer || labels.unanswered}`;
  });
  return [labels.heading, ...items].join("\n\n");
}

/** Recovers the answers from a reply the card sent; a message written otherwise yields none. */
export function clarificationAnswersFromReply(
  clarification: AnswerClarification,
  reply: string,
  labels: ClarificationReplyLabels,
): Record<string, string> {
  if (!reply.startsWith(`${labels.heading}\n\n`)) return {};
  const answers: Record<string, string> = {};
  const { questions } = clarification;
  questions.forEach((question, index) => {
    const header = replyHeader(index, question, labels);
    const start = reply.indexOf(header);
    if (start < 0) return;
    const from = start + header.length;
    const next = questions[index + 1];
    const end = next ? reply.indexOf(`\n\n${replyHeader(index + 1, next, labels)}`, from) : -1;
    const answer = reply.slice(from, end < 0 ? undefined : end).trim();
    if (answer !== "" && answer !== labels.unanswered) answers[question.questionId] = answer;
  });
  return answers;
}

/** Renders the asked questions for the next turn's chat history. */
export function clarificationHistoryText(clarification: AnswerClarification): string {
  return [
    "Clarifying questions asked instead of answering:",
    ...clarification.questions.map((question, index) => `${index + 1}. ${question.prompt}`),
  ].join("\n");
}

function replyHeader(
  index: number,
  question: AnswerClarificationQuestion,
  labels: ClarificationReplyLabels,
): string {
  return `${index + 1}. ${question.prompt}\n${labels.answer}: `;
}
