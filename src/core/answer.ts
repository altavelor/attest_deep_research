import { Citation } from "./model/citation";
import { RetrievedChunk } from "./model/source";
import { ContextDiagnostics } from "./diagnostics";
import { AnswerArtifact } from "./media";

/**
 * A web page the answer cited for which no evidence was gathered. It carries no
 * verified text, so it is kept apart from `evidence`/`citations` and only
 * contributes a numbered link to the source list.
 */
export interface AnswerWebReference {
  id: string;
  url: string;
}

export const WEB_REFERENCE_ID_PREFIX = "web-ref-";

export function isWebReferenceId(id: string): boolean {
  return id.startsWith(WEB_REFERENCE_ID_PREFIX);
}

export interface AnswerClarificationQuestion {
  questionId: string;
  prompt: string;
  suggestions: readonly string[];
}

/** Clarifying questions a Thinking turn asked instead of answering. */
export interface AnswerClarification {
  questions: readonly AnswerClarificationQuestion[];
}

export interface ResearchAnswer {
  question: string;
  answer: string;
  citations: Citation[];
  evidence?: RetrievedChunk[];
  contextDiagnostics?: ContextDiagnostics;
  followUpQuestions: string[];

  webReferences?: AnswerWebReference[];

  artifacts?: AnswerArtifact[];

  clarification?: AnswerClarification;
  createdAt: string;
  isFallback?: true;
  fallbackReason?: string;
}
