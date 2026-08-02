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

  artifacts?: AnswerArtifact[];
  createdAt: string;
  isFallback?: true;
  fallbackReason?: string;
}
