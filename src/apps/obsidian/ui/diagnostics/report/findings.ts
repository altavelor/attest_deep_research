import {
  AnswerSection,
  Finding,
  FindingsSection,
  ModelSection,
  PreflightSection,
  ReasoningSection,
  RequestSection,
} from "./types";

interface ReportSections {
  model: ModelSection;
  preflight: PreflightSection;
  request: RequestSection;
  reasoning: ReasoningSection;
  answer: AnswerSection;
}

export function computeFindings(sections: ReportSections): FindingsSection {
  const findings: Finding[] = [];
  const { model, preflight, request, reasoning, answer } = sections;

  if (model.toolCapabilities.calls === false && model.executionStrategy !== "instant") {
    findings.push({
      severity: "error",
      code: "tool-calls-blocked",
      title: "Tool calls unavailable for this model",
      detail:
        "The model does not support tool calling. Thinking research requires tool calls. Run the capability probe in Settings to check support, or set tool capabilities manually.",
      affectedSection: "model",
      evidence: { calls: false, provenance: model.toolCapabilities.provenance },
    });
  }

  if (
    model.executionStrategy !== "instant" &&
    request.thinkingPolicy.policyReason !== "thinking-eligible" &&
    request.thinkingPolicy.policyReason !== "instant-selected"
  ) {
    findings.push({
      severity: "error",
      code: "thinking-policy-fallback",
      title: `Thinking mode blocked: ${request.thinkingPolicy.policyReason}`,
      detail: `The research request fell back to Instant because: ${request.thinkingPolicy.policyReason}. Check model capabilities and search provider configuration.`,
      affectedSection: "request",
      evidence: { policyReason: request.thinkingPolicy.policyReason },
    });
  }

  if (reasoning.thinkingLoop) {
    const unsatisfied =
      reasoning.thinkingLoop.satisfiedTools !== undefined
        ? request.thinkingPolicy.requiredTools.filter(
            (t) => !reasoning.thinkingLoop!.satisfiedTools.includes(t),
          )
        : [];
    if (unsatisfied.length > 0) {
      findings.push({
        severity: "error",
        code: "mandatory-tool-unsatisfied",
        title: "Required tools were not satisfied",
        detail: `The thinking loop finished without satisfying required tools: ${unsatisfied.join(", ")}. Check tool availability and model behavior.`,
        affectedSection: "reasoning",
        evidence: {
          unsatisfied,
          satisfiedTools: reasoning.thinkingLoop.satisfiedTools,
          fallbackReason: reasoning.thinkingLoop.fallbackReason,
        },
      });
    }
  }

  if (request.retrieval) {
    const ranked = request.retrieval.rankedChunks;
    if (ranked.length > 0 && ranked.every((c) => c.status === "dropped")) {
      findings.push({
        severity: "warning",
        code: "all-chunks-dropped",
        title: "All retrieved chunks were dropped by the evidence planner",
        detail:
          "Every chunk returned by the index was dropped. Check score thresholds, evidence planner policy, and budget settings.",
        affectedSection: "request",
        evidence: {
          droppedCount: ranked.length,
          policyReason: request.evidencePlanner?.budget.policy,
        },
      });
    }
  }

  if (
    preflight.index &&
    preflight.index.indexedFiles === 0 &&
    (request.retrieval?.rankedChunks.length ?? 0) > 0
  ) {
    findings.push({
      severity: "warning",
      code: "index-files-zero-but-chunks-found",
      title: "Index reports 0 files but retrieval returned chunks",
      detail:
        "The index status shows indexedFiles=0, yet retrieval found chunks. This may indicate a stale index status counter. Re-index the vault to resolve.",
      affectedSection: "preflight",
      evidence: { indexedFiles: 0, chunksFound: request.retrieval?.rankedChunks.length },
    });
  }

  if (
    reasoning.thinkingLoop &&
    reasoning.thinkingLoop.totalCalls === 0 &&
    reasoning.thinkingLoop.totalRounds > 0
  ) {
    findings.push({
      severity: "warning",
      code: "thinking-loop-zero-tool-calls",
      title: "Thinking loop ran but made no tool calls",
      detail:
        "The model completed all rounds without calling any tools. The answer may be based on context alone, without retrieval.",
      affectedSection: "reasoning",
      evidence: { rounds: reasoning.thinkingLoop.totalRounds, totalCalls: 0 },
    });
  }

  if (
    preflight.context.budget.utilizationPct !== null &&
    preflight.context.budget.utilizationPct > 90
  ) {
    findings.push({
      severity: "warning",
      code: "context-near-limit",
      title: "Context window above 90% utilization",
      detail: `Context is at ${preflight.context.budget.utilizationPct}% of the model's context limit. Some evidence may have been dropped. Consider reducing evidence limit or using a model with a larger context window.`,
      affectedSection: "preflight",
      evidence: {
        utilizationPct: preflight.context.budget.utilizationPct,
        usedTokens: preflight.context.budget.usedTokens,
        limitTokens: preflight.context.budget.limitTokens,
      },
    });
  }

  if (reasoning.stream && !reasoning.stream.terminalEventObserved) {
    findings.push({
      severity: "warning",
      code: "stream-terminal-missing",
      title: "Stream ended without a terminal event",
      detail:
        "The model's streaming response did not produce a recognized terminal event (done/stop). The response may be truncated.",
      affectedSection: "reasoning",
      evidence: { terminalEventObserved: false, frameCount: reasoning.stream.frameCount },
    });
  }

  if (answer.unknownCitationIds.length > 0) {
    findings.push({
      severity: "info",
      code: "unknown-citations",
      title: "Answer contains citation IDs not found in evidence",
      detail: `The model cited ${answer.unknownCitationIds.length} ID(s) that do not correspond to any retrieved evidence chunk. They are excluded from citation metadata and may remain visible in the answer text.`,
      affectedSection: "answer",
      evidence: { ids: answer.unknownCitationIds },
    });
  }

  if (answer.unverifiedCitations.length > 0) {
    findings.push({
      severity: "warning",
      code: "unverified-citations",
      title: "Answer cites sources whose text does not support the claim",
      detail: `${answer.unverifiedCitations.length} citation(s) point to a real evidence chunk whose wording does not lexically overlap the surrounding claim. The citation may be misattributed — verify against the source before relying on it.`,
      affectedSection: "answer",
      evidence: { ids: answer.unverifiedCitations },
    });
  }

  if (answer.stats && !answer.stats.citations.verificationRan) {
    findings.push({
      severity: "warning",
      code: "citation-verification-not-run",
      title: "Citation verification was not run",
      detail:
        "Citation checks were not performed for this answer, so no conclusion about citation validity can be drawn.",
      affectedSection: "answer",
      evidence: {},
    });
  }
  if (answer.stats && answer.stats.citations.per100Words > 10) {
    findings.push({
      severity: "warning",
      code: "citation-density-high",
      title: "Citation density is high",
      detail: `The answer has ${answer.stats.citations.per100Words} citations per 100 words.`,
      affectedSection: "answer",
      evidence: { per100Words: answer.stats.citations.per100Words },
    });
  }
  if (answer.stats && answer.stats.citations.uncitedPromptSourceIds.length > 0) {
    findings.push({
      severity: "info",
      code: "prompt-sources-uncited",
      title: "Prompt sources were not cited",
      detail: `${answer.stats.citations.uncitedPromptSourceIds.length} source(s) included in the prompt were not cited.`,
      affectedSection: "answer",
      evidence: { ids: answer.stats.citations.uncitedPromptSourceIds },
    });
  }

  if (preflight.index?.isStale) {
    findings.push({
      severity: "info",
      code: "index-stale",
      title: "Index is stale",
      detail:
        "The vault index has not been refreshed since files were modified. Retrieval results may not reflect recent changes. Re-index to update.",
      affectedSection: "preflight",
      evidence: { isStale: true },
    });
  }

  const order = { error: 0, warning: 1, info: 2 } as const;
  findings.sort((a, b) => order[a.severity] - order[b.severity]);

  const summary = buildSummary(findings);
  return { summary, findings };
}

function buildSummary(findings: Finding[]): string {
  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warning");

  if (errors.length > 0) {
    return `${errors.length} error(s) found: ${errors.map((e) => e.code).join(", ")}.`;
  }
  if (warnings.length > 0) {
    return `No errors. ${warnings.length} warning(s): ${warnings.map((w) => w.code).join(", ")}.`;
  }
  return "No issues detected.";
}
