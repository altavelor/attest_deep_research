import { summarizeCompactionWithModel } from "@application/use-cases/chat/ChatCompaction";
import { SearchProvider } from "@application/ports/web";
import { VaultWriter } from "@application/ports/vault";
import { ApiFormat, ChatModelProvider, ChatRequest, ModelRoundProvider } from "@core/agent";
import { ToolCallingCapabilities } from "@core/agent";
import { ResearchAnswer } from "@core/answer";
import {
  ContextIndexDiagnostics,
  IndexDescriptionPromptContext,
  ResearchExecutionStrategy,
  ToolCapabilityProbeAudit,
} from "@core/diagnostics";
import { AnswerSynthesisService, AnswerSynthesisServiceOptions } from "./AnswerSynthesisService";
import {
  ContextAssembler,
  ContextAssembleRequest,
} from "@application/use-cases/chat/ContextAssembler";
import { EvidencePlanner, EvidencePlannerOptions } from "@core/research";
import {
  NoteToolService,
  ResearchToolsetFactory,
  ToolLoopRunner,
} from "@application/research/toolPorts";
import { VaultResearchPipeline } from "./VaultResearchPipeline";
import { WebResearchPipeline } from "./WebResearchPipeline";
import {
  ResearchRequest,
  ResearchRetriever,
  ResearchSearchMode,
  ResearchStreamEvent,
  QueryExpansion,
  UrlStatusChecker,
} from "@application/contracts/research";
import { ConversationEngine } from "@application/contracts/conversationView";
import { ChatDisplayMessage, ConversationCompactionSummary } from "@core/conversation";
import { resolveResearchExecutionPolicy } from "@core/research";
import { ThinkingResearchFailure } from "./ThinkingResearchRunner";
import { resolveSearchMode } from "./strategies/searchMode";
import { ResearchExecutionContext, ResearchStrategyDeps } from "./strategies/ResearchStrategy";
import { ThinkingResearchStrategy } from "./strategies/ThinkingResearchStrategy";
import { InstantResearchStrategy } from "./strategies/InstantResearchStrategy";
import { SubAgentRunner } from "./sub-agent/SubAgentRunner";
import { SubAgentLogger, SubAgentPort } from "@application/research/subAgentPort";

export type { ResearchRequest, ResearchRetriever, ResearchSearchMode, ResearchStreamEvent };

export interface ResearchServiceOptions {
  retriever: ResearchRetriever;
  chatModel: ChatModelProvider;
  chatModelName: string;
  chatOptions?: Pick<ChatRequest, "temperature" | "maxTokens">;
  searchProvider?: SearchProvider;
  urlStatusChecker?: UrlStatusChecker;
  queryExpansion?: QueryExpansion;
  contextAssembler?: ContextAssembler;
  graphContext?: ContextAssembleRequest["graph"];
  evidenceLimit?: number;
  evidencePlanner?: EvidencePlannerOptions;
  contextLimitTokens?: number;
  temperature?: number;
  now?: () => Date;
  persistFinalAnswer?: (answer: ResearchAnswer) => void | Promise<void>;
  noteTools?: NoteToolService;
  /** Writes downloaded documents into the vault; enables the download tools when present. */
  vaultWriter?: VaultWriter;
  /** Default vault folder for downloaded documents. */
  downloadFolder?: string;
  /** Builds the research toolset (concrete factory injected by the composition root). */
  toolsetFactory: ResearchToolsetFactory;
  /** Runs the note tool loop (concrete impl injected by the composition root). */
  runToolLoop: ToolLoopRunner;
  /** Builds a default ModelRoundProvider from the chat model (concrete adapter injected by the composition root). */
  modelRoundFactory: (chatModel: ChatModelProvider) => ModelRoundProvider;
  toolsEnabled?: boolean;
  getIndexStatus?: () => ContextIndexDiagnostics;
  indexDescription?: IndexDescriptionPromptContext;
  toolCapabilities?: ToolCallingCapabilities;
  toolCapabilityProvenance?: Record<string, string>;
  toolCapabilityProbeAudit?: ToolCapabilityProbeAudit;
  apiFormat?: ApiFormat;
  modelRound?: ModelRoundProvider;
  reasoning?: { enabled: boolean; effort?: string; summary: "off" | "auto" };
  reasoningDiagnostics?: AnswerSynthesisServiceOptions["reasoningDiagnostics"];
  /** Optional diagnostic sink for the sub-agent (gated by debug mode). */
  subAgentLogger?: SubAgentLogger;
}

const DEFAULT_EVIDENCE_LIMIT = 8;
const DEFAULT_TEMPERATURE = 0.2;

/**
 * Coordinates a single research turn. The actual work is delegated to two
 * isolated strategies — {@link ThinkingResearchStrategy} (tool-driven) and
 * {@link InstantResearchStrategy} (deterministic) — while this service owns only
 * the policy decision and the cross-strategy fallback from thinking to instant.
 */
export class ResearchService implements ConversationEngine {
  private readonly vaultPipeline: VaultResearchPipeline;
  private readonly answerSynthesis: AnswerSynthesisService;
  private readonly evidenceLimit: number;
  private readonly chatModel: ChatModelProvider;
  private readonly chatModelName: string;
  private readonly chatOptions: Pick<ChatRequest, "temperature" | "maxTokens">;
  private readonly indexDescription?: IndexDescriptionPromptContext;
  private readonly toolCapabilities: ToolCallingCapabilities;
  private readonly apiFormat?: ApiFormat;

  private readonly thinking: ThinkingResearchStrategy;
  private readonly instant: InstantResearchStrategy;

  constructor(options: ResearchServiceOptions) {
    const evidenceLimit = options.evidenceLimit ?? DEFAULT_EVIDENCE_LIMIT;
    const now = options.now ?? (() => new Date());
    const chatOptions = {
      temperature: options.chatOptions?.temperature ?? options.temperature ?? DEFAULT_TEMPERATURE,
      maxTokens: options.chatOptions?.maxTokens,
    };
    const toolCapabilities = options.toolCapabilities ?? {
      calls: false,
      choiceRequired: false,
      choiceSpecific: false,
      parallelCalls: false,
    };

    this.evidenceLimit = evidenceLimit;
    this.chatModel = options.chatModel;
    this.chatModelName = options.chatModelName;
    this.chatOptions = chatOptions;
    this.indexDescription = options.indexDescription;
    this.toolCapabilities = toolCapabilities;
    this.apiFormat = options.apiFormat;

    this.vaultPipeline = new VaultResearchPipeline({
      retriever: options.retriever,
      queryExpansion: options.queryExpansion,
      evidenceLimit,
    });
    const webPipeline = new WebResearchPipeline({
      searchProvider: options.searchProvider,
      evidenceLimit,
    });
    this.answerSynthesis = new AnswerSynthesisService({
      chatModel: options.chatModel,
      modelRound: options.modelRound,
      reasoning: options.reasoning,
      reasoningDiagnostics: options.reasoningDiagnostics,
      chatModelName: options.chatModelName,
      chatOptions,
      contextLimitTokens: options.contextLimitTokens,
      now,
      persistFinalAnswer: options.persistFinalAnswer,
      noteTools: options.noteTools,
      runToolLoop: options.runToolLoop,
    });

    // The universal sub-agent reuses the parent chat model. It is created whenever
    // there is a chat model (always): callers pass a per-turn `toolContext` so the
    // `run_subagent` / `map_sources` tools it backs mirror whatever the parent has
    // this turn (index/web/notes). The search provider is only a web-only *fallback*
    // for the rare call with no `toolContext`, so an index-only profile (no web)
    // still gets a working sub-agent — the corpus fan-out (map_sources) needs it.
    const subAgentRunner: SubAgentPort = new SubAgentRunner({
      toolsetFactory: options.toolsetFactory,
      ...(options.searchProvider ? { searchProvider: options.searchProvider } : {}),
      modelRound: options.modelRound ?? options.modelRoundFactory(options.chatModel),
      model: options.chatModelName,
      temperature: chatOptions.temperature,
      maxTokens: chatOptions.maxTokens,
      reasoning: options.reasoning,
      ...(options.subAgentLogger ? { logger: options.subAgentLogger } : {}),
    });

    const deps: ResearchStrategyDeps = {
      chatModel: options.chatModel,
      chatModelName: options.chatModelName,
      chatOptions,
      apiFormat: options.apiFormat,
      modelRound: options.modelRound,
      modelRoundFactory: options.modelRoundFactory,
      reasoning: options.reasoning,
      reasoningDiagnostics: options.reasoningDiagnostics,
      contextAssembler: options.contextAssembler,
      graphContext: options.graphContext,
      contextLimitTokens: options.contextLimitTokens,
      reservedOutputTokens: options.chatOptions?.maxTokens,
      evidenceLimit,
      evidencePlanner: new EvidencePlanner(options.evidencePlanner),
      vaultPipeline: this.vaultPipeline,
      webPipeline,
      answerSynthesis: this.answerSynthesis,
      retriever: options.retriever,
      urlStatusChecker: options.urlStatusChecker,
      searchProvider: options.searchProvider,
      noteTools: options.noteTools,
      vaultWriter: options.vaultWriter,
      downloadFolder: options.downloadFolder,
      toolsetFactory: options.toolsetFactory,
      subAgentRunner,
      toolsEnabled: options.toolsEnabled === true && options.noteTools !== undefined,
      toolCapabilities,
      toolCapabilityProvenance: options.toolCapabilityProvenance,
      toolCapabilityProbeAudit: options.toolCapabilityProbeAudit,
      getIndexStatus: options.getIndexStatus,
      indexDescription: options.indexDescription,
      now,
      persistFinalAnswer: options.persistFinalAnswer,
    };
    this.thinking = new ThinkingResearchStrategy(deps);
    this.instant = new InstantResearchStrategy(deps);
  }

  async *answer(request: ResearchRequest): AsyncIterable<ResearchStreamEvent> {
    const question = request.question.trim();
    const searchMode = resolveSearchMode(request);
    const policy = resolveResearchExecutionPolicy({
      mode: request.forceSubAgent === true ? "thinking" : (request.mode ?? "instant"),
      capabilities: this.toolCapabilities,
      apiFormat: this.apiFormat,
    });
    if (policy.strategy === "deep-research") {
      throw new Error("Deep Research is not available yet.");
    }
    const indexDescription =
      searchMode === "indexOnly" || searchMode === "indexAndWeb"
        ? this.indexDescription
        : undefined;
    const ctx: ResearchExecutionContext = {
      request,
      question,
      searchMode,
      policy,
      indexDescription,
    };

    let executionStrategy: ResearchExecutionStrategy = policy.strategy;
    let failedThinkingAttempt: ThinkingResearchFailure | undefined;

    if (policy.strategy === "instant-fallback") {
      yield {
        type: "status",
        message: "Thinking requires tool calling for this model. Using Instant instead.",
      };
    }

    if (policy.strategy === "thinking") {
      const outcome = yield* this.thinking.execute(ctx);
      if (outcome.kind === "completed" || outcome.kind === "cancelled") return;
      // Thinking attempt failed. If it gathered partial evidence, synthesize a
      // best-effort answer from it; otherwise fall through to the deterministic
      // instant pipeline so a diagnostic report is still produced.
      const partialEvidence = outcome.answer.evidence ?? [];
      if (partialEvidence.length > 0) {
        yield { type: "status", message: "Synthesizing from partial results…" };
        yield* this.answerSynthesis.synthesize({
          question,
          evidence: partialEvidence,
          citations: outcome.answer.citations ?? [],
          chatHistory: request.chatHistory,
          evidenceLimit: this.evidenceLimit,
          contextDiagnostics:
            request.includeContextDiagnostics === true ? outcome.diagnostics : undefined,
          signal: request.signal,
          fallback: { reason: outcome.failure.reason },
        });
        return;
      }
      failedThinkingAttempt = outcome.failure;
      executionStrategy = "instant-fallback";
    }

    yield* this.instant.execute({ ...ctx, executionStrategy, failedThinkingAttempt });
  }

  async summarizeChatHistoryForCompaction(
    messages: ChatDisplayMessage[],
    existingSummary?: ConversationCompactionSummary,
  ): Promise<ConversationCompactionSummary> {
    return summarizeCompactionWithModel({
      chatModel: this.chatModel,
      model: this.chatModelName,
      messages,
      existingSummary,
      temperature: 0,
      maxTokens: this.chatOptions.maxTokens,
    });
  }
}
