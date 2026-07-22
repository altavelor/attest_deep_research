import { formatCitation } from "@core/retrieval";
import { ContextDiagnostics } from "@core/diagnostics";
import { estimateTextTokens } from "@core/research";
import { ResearchStreamEvent } from "@application/contracts/research";
import { ThinkingResearchFailure } from "../ThinkingResearchRunner";
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
export class InstantResearchStrategy implements ResearchStrategy {
  constructor(private readonly deps: ResearchStrategyDeps) {}

  async *execute(
    ctx: ResearchExecutionContext,
  ): AsyncGenerator<ResearchStreamEvent, ResearchStrategyOutcome> {
    const { request, question, searchMode, policy, indexDescription } = ctx;
    const executionStrategy = ctx.executionStrategy ?? policy.strategy;
    const failedThinkingAttempt = ctx.failedThinkingAttempt;

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
            evidenceLimit: this.deps.evidenceLimit,
            skipRetrieval: searchMode === "none",
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
    const retrieval =
      searchMode === "webOnly" || searchMode === "none"
        ? emptyRetrievalResult()
        : yield* this.deps.vaultPipeline.search(
            question,
            assembled?.retrievalSourcePaths ?? request.contextPaths,
            assembled?.boostedSourcePaths,
          );
    const webEvidence = yield* this.deps.webPipeline.search(
      question,
      searchMode !== "indexOnly" && searchMode !== "none",
    );
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
    const rawGraphEvidence = graphEvidenceFromRetrieval(
      retrieval.chunks,
      assembled?.graphSourcePaths ?? [],
    );
    const rawRetrievalEvidence = nonExplicitEvidence(retrieval.chunks, rawGraphEvidence);

    const planned = this.deps.evidencePlanner.plan({
      question,
      chatHistory: request.chatHistory,
      contextLimitTokens: this.deps.contextLimitTokens,
      reservedOutputTokens: totalReservedWithIndexTokens,
      evidenceLimit: this.deps.evidenceLimit,
      searchMode,
      explicitEvidence: assembled?.explicitEvidence ?? [],
      graphEvidence: rawGraphEvidence,
      retrievalEvidence: rawRetrievalEvidence,
      webEvidence: webEvidence.chunks,
    });
    const explicitCitations = (assembled?.explicitEvidence ?? []).map((chunk) => ({
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
      evidenceLimit: this.deps.evidenceLimit,
      toolsEnabled: this.deps.toolsEnabled,
      retrievalDiagnostics: isRagDebugIntent(question)
        ? buildRagDiagnosticSnapshot(diagnostics)
        : undefined,
      indexDescription,
      signal: request.signal,
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
    }
  }
}
