import { ApiFormat, ChatModelProvider, ChatRequest, ModelRoundProvider } from "../../../core/agent/protocol";
import { ToolCallingCapabilities } from "../../../core/agent/tool";
import { ResearchAnswer } from "../../../core/answer";
import {
  ContextDiagnostics,
  ContextIndexDiagnostics,
  IndexDescriptionPromptContext,
  ResearchExecutionStrategy,
  ToolCapabilityProbeAudit,
} from "../../../core/diagnostics";
import { EvidencePlanner } from "../../../core/research/EvidencePlanner";
import { ResearchExecutionPolicy } from "../../../core/research/ResearchExecutionPolicy";
import { SearchProvider } from "../../ports/web";
import {
  ResearchRequest,
  ResearchRetriever,
  ResearchSearchMode,
  ResearchStreamEvent,
  UrlStatusChecker,
} from "../../contracts/research";
import { NoteToolService, ResearchToolsetFactory } from "../../research/toolPorts";
import { DeepResearchRunner } from "../../research/deepResearchPort";
import { AnswerSynthesisService, AnswerSynthesisServiceOptions } from "../AnswerSynthesisService";
import { ContextAssembler, ContextAssembleRequest } from "../ContextAssembler";
import { VaultResearchPipeline } from "../VaultResearchPipeline";
import { WebResearchPipeline } from "../WebResearchPipeline";
import { AgenticResearchFailure } from "../AgenticResearchRunner";

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
  noteTools?: NoteToolService;
  toolsetFactory: ResearchToolsetFactory;
  /** Launches deep-research sub-agents for the `deep_search` tool, when available. */
  deepResearchRunner?: DeepResearchRunner;
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
   * dispatcher overrides it with `deterministic-fallback` when invoking the
   * eager strategy after a failed agentic attempt. Ignored by the agentic path.
   */
  executionStrategy?: ResearchExecutionStrategy;
  /**
   * Present when this run is the deterministic fallback after a failed agentic
   * attempt, so its diagnostics can be carried into the eager report. Ignored by
   * the agentic path.
   */
  failedAgenticAttempt?: AgenticResearchFailure;
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
      failure: AgenticResearchFailure;
      answer: ResearchAnswer;
      diagnostics?: ContextDiagnostics;
    };

export interface ResearchStrategy {
  execute(
    ctx: ResearchExecutionContext,
  ): AsyncGenerator<ResearchStreamEvent, ResearchStrategyOutcome>;
}
