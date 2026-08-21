import { ApiFormat, ChatModelProvider, ChatRequest, ModelRoundProvider } from "@core/agent";
import { ToolCallingCapabilities } from "@core/agent";
import { ResearchAnswer } from "@core/answer";
import type { DocumentImageDiscovery, ImageSearchRegistry } from "@application/ports";
import {
  ContextDiagnostics,
  ContextIndexDiagnostics,
  IndexDescriptionPromptContext,
  ResearchExecutionStrategy,
  ToolCapabilityProbeAudit,
} from "@core/diagnostics";
import { EvidencePlanner } from "@core/research";
import { ResearchExecutionPolicy, ResearchModeRetrievalParameters } from "@core/research";
import { SearchProvider } from "@application/ports/web";
import { VaultWriter } from "@application/ports/vault";
import {
  ResearchRequest,
  ResearchRetriever,
  ResearchSearchMode,
  ResearchStreamEvent,
  UrlStatusChecker,
} from "@application/contracts/research";
import { NoteToolService, ResearchToolsetFactory } from "@application/research/toolPorts";
import { SubAgentPort } from "@application/research/subAgentPort";
import { AnswerSynthesisService, AnswerSynthesisServiceOptions } from "../AnswerSynthesisService";
import {
  ContextAssembler,
  ContextAssembleRequest,
} from "@application/use-cases/chat/ContextAssembler";
import { VaultResearchPipeline } from "../VaultResearchPipeline";
import { WebResearchPipeline } from "../WebResearchPipeline";
import { ThinkingResearchFailure } from "../ThinkingResearchRunner";

export interface ResearchStrategyDeps {
  chatModel: ChatModelProvider;
  chatModelName: string;
  chatOptions: Pick<ChatRequest, "temperature" | "maxTokens">;
  apiFormat?: ApiFormat;
  modelRound?: ModelRoundProvider;
  modelRoundFactory: (chatModel: ChatModelProvider) => ModelRoundProvider;
  reasoning?: { enabled: boolean; effort?: string; summary: "off" | "auto" };
  reasoningDiagnostics?: AnswerSynthesisServiceOptions["reasoningDiagnostics"];
  contextAssembler?: ContextAssembler;
  graphContext?: ContextAssembleRequest["graph"];
  contextLimitTokens?: number;
  reservedOutputTokens?: number;
  evidenceLimit: number;
  evidencePlanner: EvidencePlanner;
  vaultPipeline: VaultResearchPipeline;
  webPipeline: WebResearchPipeline;
  answerSynthesis: AnswerSynthesisService;
  retriever?: ResearchRetriever;
  urlStatusChecker?: UrlStatusChecker;
  searchProvider?: SearchProvider;

  imageSearch?: ImageSearchRegistry;

  documentImageCandidates?: DocumentImageDiscovery;
  noteTools?: NoteToolService;
  vaultWriter?: VaultWriter;
  downloadFolder?: string;
  toolsetFactory: ResearchToolsetFactory;

  subAgentRunner?: SubAgentPort;
  toolsEnabled: boolean;
  toolCapabilities: ToolCallingCapabilities;
  toolCapabilityProvenance?: Record<string, string>;
  toolCapabilityProbeAudit?: ToolCapabilityProbeAudit;
  getIndexStatus?: () => ContextIndexDiagnostics;
  indexDescription?: IndexDescriptionPromptContext;
  now: () => Date;
  persistFinalAnswer?: (answer: ResearchAnswer) => void | Promise<void>;
}

export interface ResearchExecutionContext {
  request: ResearchRequest;
  question: string;
  searchMode: ResearchSearchMode;
  policy: ResearchExecutionPolicy;
  retrieval: ResearchModeRetrievalParameters;
  indexDescription?: IndexDescriptionPromptContext;

  executionStrategy?: ResearchExecutionStrategy;

  failedThinkingAttempt?: ThinkingResearchFailure;
}

export type ResearchStrategyOutcome =
  | { kind: "completed" }
  | { kind: "cancelled" }
  | {
      kind: "failed";
      failure: ThinkingResearchFailure;
      answer: ResearchAnswer;
      diagnostics?: ContextDiagnostics;
    };

export interface ResearchStrategy {
  execute(
    ctx: ResearchExecutionContext,
  ): AsyncGenerator<ResearchStreamEvent, ResearchStrategyOutcome>;
}
