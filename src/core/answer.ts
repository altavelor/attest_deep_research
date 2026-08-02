// Research answer DTO (stage 1, tasks 1.4 + 2.1). Core domain result.

import { Citation } from "./model/citation";
import { RetrievedChunk } from "./model/source";
import { ContextDiagnostics } from "./diagnostics";
import { AnswerArtifact } from "./media";

export interface ResearchAnswer {
  question: string;
  answer: string;
  citations: Citation[];
  evidence?: RetrievedChunk[];
  contextDiagnostics?: ContextDiagnostics;
  followUpQuestions: string[];
  /** Galleries and charts appended after the Markdown answer; absent means none. */
  artifacts?: AnswerArtifact[];
  createdAt: string;
  isFallback?: true;
  fallbackReason?: string;
}
