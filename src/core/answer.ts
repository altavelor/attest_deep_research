// Research answer DTO (stage 1, tasks 1.4 + 2.1). Core domain result.

import { Citation } from "./model/citation";
import { RetrievedChunk } from "./model/source";
import { ContextDiagnostics } from "./diagnostics";

export interface ResearchAnswer {
  question: string;
  answer: string;
  citations: Citation[];
  evidence?: RetrievedChunk[];
  contextDiagnostics?: ContextDiagnostics;
  followUpQuestions: string[];
  createdAt: string;
  isFallback?: true;
  fallbackReason?: string;
}
