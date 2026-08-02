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
import { ResearchExecutionPolicy } from "@core/research";
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

/**
 * Collaborators shared by every research execution strategy. Built once by the
 * composition in {@link ResearchService} and handed to each strategy so the
 * strategies stay isolated entities rather than reaching back into the service.
 */
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
  retriever: ResearchRetriever;
  urlStatusChecker?: UrlStatusChecker;
  searchProvider?: SearchProvider;
  /** Enabled image-search resources for the rich-media tools. */
  imageSearch?: ImageSearchRegistry;
  /** Image candidates from the documents attached to the request context. */
  documentImageCandidates?: DocumentImageDiscovery;
  noteTools?: NoteToolService;
  vaultWriter?: VaultWriter;
  downloadFolder?: string;
  toolsetFactory: ResearchToolsetFactory;
  /** Launches universal sub-agents for the `run_subagent` tool, when available. */
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

/** Per-request inputs resolved by the dispatcher before a strategy runs. */
export interface ResearchExecutionContext {
  request: ResearchRequest;
  question: string;
  searchMode: ResearchSearchMode;
  policy: ResearchExecutionPolicy;
  indexDescription?: IndexDescriptionPromptContext;
  /**
   * Strategy label recorded in diagnostics. Defaults to `policy.strategy`; the
   * dispatcher overrides it with `instant-fallback` when invoking the
   * instant strategy after a failed thinking attempt. Ignored by the thinking path.
   */
  executionStrategy?: ResearchExecutionStrategy;
  /**
   * Present when this run is the deterministic fallback after a failed thinking
   * attempt, so its diagnostics can be carried into the instant report. Ignored by
   * the thinking path.
   */
  failedThinkingAttempt?: ThinkingResearchFailure;
}

/**
 * Result of an attempt, used by the dispatcher to decide whether to fall back.
 * A strategy fully owns its happy path (including emitting the terminal
 * `complete` event); only on `failed` does control return to the dispatcher.
 */
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
