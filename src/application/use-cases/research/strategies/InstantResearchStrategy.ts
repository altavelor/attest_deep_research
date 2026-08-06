import { formatCitation } from "@core/retrieval";
import { ContextDiagnostics, ResearchExecutionStrategy } from "@core/diagnostics";
import { estimateTextTokens } from "@core/research";
import { ResearchStreamEvent } from "@application/contracts/research";
import { RetrievalResult } from "@application/contracts";
import { AssembledContext } from "@application/use-cases/chat";
import { ThinkingResearchFailure } from "../ThinkingResearchRunner";
import { ResearchBranch, ResearchBranchStream } from "../branchStreams";
import { ResearchEvidenceResult } from "../WebResearchPipeline";
import {
  ResearchExecutionContext,
  ResearchStrategy,
  ResearchStrategyDeps,
  ResearchStrategyOutcome,
} from "./ResearchStrategy";
import { citationsForEvidence, mergeCitations } from "./citations";
import { emptyRetrievalResult, graphEvidenceFromRetrieval, nonExplicitEvidence } from "./evidence";
import {
  thinkingBudgets,
  buildRagDiagnosticSnapshot,
  createEmptyContextDiagnostics,
  isRagDebugIntent,
  semanticDegradationWarning,
  withPlannerDiagnostics,
  withRetrievalDiagnostics,
  withWebDiagnostics,
} from "./ResearchDiagnostics";

/**
 * Deterministic research path: assemble context, retrieve vault + web evidence,
 * plan it under the token budget, then synthesize. Also serves as the fallback
 * when the thinking attempt fails outright. Terminal: it always completes.
 */
interface InstantResearchRun {
  assembled: AssembledContext | undefined;
  branches: ResearchBranchStream;
  vaultBranch: ResearchBranch<RetrievalResult>;
  webBranch: ResearchBranch<ResearchEvidenceResult>;
  webAbort: AbortController;
  evidenceLimit: number;
  executionStrategy: ResearchExecutionStrategy;
  totalReservedWithIndexTokens: number;
}

export class InstantResearchStrategy implements ResearchStrategy {
  constructor(private readonly deps: ResearchStrategyDeps) {}

  async *execute(
    ctx: ResearchExecutionContext,
  ): AsyncGenerator<ResearchStreamEvent, ResearchStrategyOutcome> {
    const { request, question, searchMode, policy, indexDescription } = ctx;
    const executionStrategy = ctx.executionStrategy ?? policy.strategy;
    const evidenceLimit = ctx.retrieval.evidenceLimit;

    const totalReservedTokens = this.deps.reservedOutputTokens ?? 0;
    const totalReservedWithIndexTokens =
      totalReservedTokens + (indexDescription ? estimateTextTokens(indexDescription.text) : 0);
    const assembled =
      searchMode === "webOnly" || !this.deps.contextAssembler
        ? undefined
        : await this.deps.contextAssembler.assemble({
            question,
            contextMode: searchMode === "none" ? "include" : (request.contextMode ?? "include"),
            contextPaths: request.contextPaths ?? [],
            activeFilePath: request.activeFilePath,
            includeActiveFile: request.includeActiveFile === true,
            chatHistory: request.chatHistory,
            contextLimitTokens: this.deps.contextLimitTokens,
            reservedOutputTokens: totalReservedWithIndexTokens,
            evidenceLimit,
            explicitSourcesOnly: searchMode === "none",
            graph: this.deps.graphContext,
          });
    if (assembled) {
      assembled.diagnostics.executionStrategy = executionStrategy;
      assembled.diagnostics.question = question;
      assembled.diagnostics.modelName = this.deps.chatModelName;
      assembled.diagnostics.modelApiFormat = this.deps.apiFormat;
      assembled.diagnostics.searchMode = searchMode;
      if (this.deps.toolCapabilityProbeAudit)
        assembled.diagnostics.probeAudit = this.deps.toolCapabilityProbeAudit;
      assembled.diagnostics.toolCapabilities = this.deps.toolCapabilities;
    }
    if (assembled) {
      yield { type: "context", diagnostics: assembled.diagnostics };
    }
    const branches = new ResearchBranchStream();
    const webAbort = new AbortController();
    const abortWeb = () => webAbort.abort();
    request.signal?.addEventListener("abort", abortWeb);
    const vaultBranch = branches.run(
      searchMode === "webOnly" || searchMode === "none"
        ? emptyRetrievalBranch()
        : this.deps.vaultPipeline.search(
            question,
            assembled?.retrievalSourcePaths ?? request.contextPaths,
            assembled?.boostedSourcePaths,
            {
              evidenceLimit,
              maxVariants: ctx.retrieval.maxQueryVariants,
              ...(request.signal ? { signal: request.signal } : {}),
            },
          ),
    );
    const webBranch = branches.run(
      this.deps.webPipeline.search(question, searchMode !== "indexOnly" && searchMode !== "none", {
        evidenceLimit,
        mode: "instant",
        web: ctx.retrieval.web,
        signal: webAbort.signal,
      }),
    );

    try {
      return yield* this.planAndSynthesize(ctx, {
        assembled,
        branches,
        vaultBranch,
        webBranch,
        webAbort,
        evidenceLimit,
        executionStrategy,
        totalReservedWithIndexTokens,
      });
    } finally {
      request.signal?.removeEventListener("abort", abortWeb);
      webAbort.abort();
      webBranch.close();
      vaultBranch.close();
    }
  }

  /**
   * Consume both branches, plan the evidence they produced and stream the
   * answer. The caller owns branch cleanup, so every exit path — including a
   * failed vault branch — releases the still-running branches.
   */
  private async *planAndSynthesize(
    ctx: ResearchExecutionContext,
    run: InstantResearchRun,
  ): AsyncGenerator<ResearchStreamEvent, ResearchStrategyOutcome> {
    const { request, question, searchMode, policy, indexDescription } = ctx;
    const { assembled, branches, vaultBranch, webBranch, webAbort, evidenceLimit } = run;
    const { executionStrategy, totalReservedWithIndexTokens } = run;
    const failedThinkingAttempt = ctx.failedThinkingAttempt;
    const retrieval = yield* branches.until(vaultBranch);
    const explicitEvidence = assembled?.explicitEvidence ?? [];
    const graphEvidenceForPlanner = graphEvidenceFromRetrieval(
      retrieval.chunks,
      assembled?.graphSourcePaths ?? [],
    );
    const retrievalEvidenceForPlanner = nonExplicitEvidence(
      retrieval.chunks,
      graphEvidenceForPlanner,
    );
    const webRequired = this.deps.evidencePlanner.requiresWebEvidence({
      question,
      searchMode,
      explicitEvidence,
      graphEvidence: graphEvidenceForPlanner,
      retrievalEvidence: retrievalEvidenceForPlanner,
    });
    const waitForWeb =
      (webRequired || webBranch.status() === "fulfilled") && request.signal?.aborted !== true;

    if (!waitForWeb) {
      webAbort.abort();
      webBranch.close();
    }

    const webEvidence = waitForWeb ? yield* branches.until(webBranch) : emptyWebEvidence();

    if (request.signal?.aborted === true) {
      return { kind: "cancelled" };
    }

    const contextDiagnostics = withRetrievalDiagnostics(
      assembled?.diagnostics ??
        createEmptyContextDiagnostics(request.contextMode ?? "include", executionStrategy),
      retrieval,
    );
    contextDiagnostics.question = question;
    contextDiagnostics.modelName = this.deps.chatModelName;
    contextDiagnostics.modelApiFormat = this.deps.apiFormat;
    contextDiagnostics.searchMode = searchMode;
    contextDiagnostics.toolCapabilities = this.deps.toolCapabilities;
    if (this.deps.toolCapabilityProbeAudit)
      contextDiagnostics.probeAudit = this.deps.toolCapabilityProbeAudit;
    if (this.deps.getIndexStatus) {
      contextDiagnostics.index = this.deps.getIndexStatus();
    }
    const planned = this.deps.evidencePlanner.plan({
      question,
      chatHistory: request.chatHistory,
      contextLimitTokens: this.deps.contextLimitTokens,
      reservedOutputTokens: totalReservedWithIndexTokens,
      evidenceLimit,
      searchMode,
      explicitEvidence,
      graphEvidence: graphEvidenceForPlanner,
      retrievalEvidence: retrievalEvidenceForPlanner,
      webEvidence: webEvidence.chunks,
    });
    const explicitCitations = explicitEvidence.map((chunk) => ({
      ...formatCitation(chunk.source),
      id: chunk.id,
    }));
    const citations = citationsForEvidence(
      planned.finalEvidence,
      mergeCitations(mergeCitations(explicitCitations, retrieval.citations), webEvidence.citations),
    );
    const diagnostics = withWebDiagnostics(
      withPlannerDiagnostics(contextDiagnostics, planned.diagnostics),
      webEvidence.diagnostics,
      planned.webEvidence,
    );
    if (indexDescription) {
      diagnostics.indexDescription = { ...indexDescription.diagnostics };
      if (indexDescription.diagnostics.freshness !== "current") {
        diagnostics.warnings.push(
          `Index description used ${indexDescription.diagnostics.freshness} deterministic fallback metadata.`,
        );
      }
    }
    const degradation = semanticDegradationWarning([retrieval]);
    if (degradation) {
      diagnostics.warnings.push(degradation);
    }
    this.applyThinkingDiagnostics(diagnostics, policy, failedThinkingAttempt);

    yield* this.deps.answerSynthesis.synthesize({
      question,
      chatHistory: request.chatHistory,
      evidence: planned.finalEvidence,
      explicitEvidence: planned.explicitEvidence,
      attachedFiles: assembled?.attachments,
      graphEvidence: planned.graphEvidence,
      retrievedEvidence: planned.retrievedEvidence,
      webEvidence: planned.webEvidence,
      citations,
      contextDiagnostics: request.includeContextDiagnostics === true ? diagnostics : undefined,
      evidenceLimit,
      toolsEnabled: policy.reason === "instant-selected" ? false : this.deps.toolsEnabled,
      retrievalDiagnostics: isRagDebugIntent(question)
        ? buildRagDiagnosticSnapshot(diagnostics)
        : undefined,
      indexDescription,
      signal: request.signal,
      disableThinking: true,
    });

    return { kind: "completed" };
  }

  private applyThinkingDiagnostics(
    diagnostics: ContextDiagnostics,
    policy: ResearchExecutionContext["policy"],
    failedThinkingAttempt: ThinkingResearchFailure | undefined,
  ): void {
    if (failedThinkingAttempt) {
      diagnostics.thinking = {
        policyReason: policy.reason,
        requiredTools: [...policy.requiredTools],
        bootstrapChoice: policy.bootstrapChoice,
        satisfiedTools: failedThinkingAttempt.satisfiedTools,
        repairedTools: failedThinkingAttempt.repairedTools,
        rounds: failedThinkingAttempt.rounds,
        totalCalls: failedThinkingAttempt.totalCalls,
        duplicateCalls: failedThinkingAttempt.duplicateCalls,
        fallbackReason: failedThinkingAttempt.reason,
        duplicatedCost: true,
        capabilityProvenance: this.deps.toolCapabilityProvenance,
        phases: failedThinkingAttempt.phases,
        reasoningSegments: failedThinkingAttempt.reasoningSegments,
        stopReasons: failedThinkingAttempt.stopReasons,
        budgets: thinkingBudgets(
          failedThinkingAttempt.totalResultChars,
          failedThinkingAttempt.maxResultChars,
        ),
      };
    } else if (policy.strategy === "instant-fallback") {
      diagnostics.thinking = {
        policyReason: policy.reason,
        requiredTools: [...policy.requiredTools],
        bootstrapChoice: policy.bootstrapChoice,
        satisfiedTools: [],
        repairedTools: [],
        rounds: 0,
        totalCalls: 0,
        duplicateCalls: 0,
        fallbackReason: policy.reason,
        duplicatedCost: false,
        capabilityProvenance: this.deps.toolCapabilityProvenance,
      };
    } else {
      diagnostics.thinking = {
        policyReason: policy.reason,
        requiredTools: [...policy.requiredTools],
        bootstrapChoice: policy.bootstrapChoice,
        satisfiedTools: [],
        repairedTools: [],
        rounds: 0,
        totalCalls: 0,
        duplicateCalls: 0,
        duplicatedCost: false,
        capabilityProvenance: this.deps.toolCapabilityProvenance,
      };
    }
  }
}

async function* emptyRetrievalBranch(): AsyncGenerator<ResearchStreamEvent, RetrievalResult> {
  return emptyRetrievalResult();
}

function emptyWebEvidence(): ResearchEvidenceResult {
  return { chunks: [], citations: [] };
}
