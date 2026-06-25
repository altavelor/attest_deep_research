import {
  ApiFormat,
  ChatToolChoice,
  ContextDiagnostics,
  ToolCallDiagnostic,
} from "../shared/types";

// ─── V3 shape types ──────────────────────────────────────────────────────────

export interface DiagnosticReportV3 {
  schemaVersion: 3;
  question: string;
  findings: FindingsSection;
  model: ModelSection;
  preflight: PreflightSection;
  request: RequestSection;
  reasoning: ReasoningSection;
  answer: AnswerSection;
  stats: StatsSection;
}

export interface FindingsSection {
  summary: string;
  findings: Finding[];
}

export interface Finding {
  severity: "error" | "warning" | "info";
  code: string;
  title: string;
  detail: string;
  affectedSection: "model" | "preflight" | "request" | "reasoning" | "answer";
  evidence: Record<string, unknown>;
}

interface ModelSection {
  name: string;
  apiFormat: ApiFormat | null;
  executionStrategy: string;
  toolCapabilities: {
    calls: boolean;
    choiceRequired: boolean;
    choiceSpecific: boolean;
    parallelCalls: boolean;
    provenance: Record<string, string>;
    probe: {
      ranAt: string;
      modelName: string;
      apiFormat: ApiFormat;
      results: { required: string[]; specific: string[]; auto: string[] };
      rawCapabilities: { calls: boolean; choiceRequired: boolean; choiceSpecific: boolean; parallelCalls: boolean };
    } | null;
  };
  reasoning: {
    protocol: string;
    capabilitySource: string | null;
    configuredEffort: string | null;
    summaryRequested: boolean;
    summaryAvailable: boolean;
  } | null;
}

interface PreflightSection {
  index: {
    status: string;
    available: boolean;
    isStale: boolean;
    indexedFiles: number;
    errorMessage?: string;
  } | null;
  indexDescription: {
    freshness: string;
    textHash: string;
    algorithmVersion: number;
    generatedAt: string;
    indexUpdatedAt: string;
    representativeChunkCount: number;
    truncated: boolean;
    usedFallback: boolean;
    failureReason?: string;
  } | null;
  context: {
    mode: string;
    sources: ContextDiagnostics["explicitSources"];
    graph: ContextDiagnostics["graph"];
    budget: {
      limitTokens: number | null;
      reservedOutputTokens: number | null;
      usedTokens: number;
      utilizationPct: number | null;
      groups: ContextDiagnostics["budget"]["groups"];
    };
  };
  warnings: string[];
}

interface RequestSection {
  searchMode: string;
  agenticPolicy: {
    policyReason: string;
    requiredTools: string[];
    bootstrapChoice: ChatToolChoice | null;
  };
  retrieval: {
    queryVariants: string[];
    filteredSourcePaths: string[];
    rankedChunks: Array<{
      id: string;
      path: string;
      rank: number;
      score: number;
      status: "included" | "dropped" | "filtered";
      reason?: string;
      dropReason?: string;
    }>;
    includedChunkIds: string[];
    droppedChunkIds: string[];
    scoreStats: { min: number; max: number; avg: number; threshold: number | null } | null;
  } | null;
  web: ContextDiagnostics["web"] | null;
  evidencePlanner: ContextDiagnostics["evidencePlanner"] | null;
}

interface AgenticLoopRound {
  round: number;
  phase: string;
  toolCalls: ToolCallDiagnostic[];
  reasoningSegments: Array<{ segmentId: string; chars: number }>;
  hadTextOutput: boolean;
  classification: "intermediate" | "final" | "discarded" | null;
}

interface ReasoningSection {
  attempts: Array<{
    attempt: number;
    protocol: string;
    status: string;
    outputEmitted: boolean;
    errorCode?: string;
    fallbackDecision?: string;
  }>;
  stream: ContextDiagnostics["stream"] | null;
  agenticLoop: {
    totalRounds: number;
    totalCalls: number;
    duplicateCalls: number;
    satisfiedTools: string[];
    repairedTools: string[];
    fallbackReason?: string;
    stopReasons: string[];
    budgets: {
      maxRounds: number;
      maxResultChars: number;
      usedResultChars: number;
    } | null;
    rounds: AgenticLoopRound[];
  } | null;
  tokens: { inputTokens: number; outputTokens: number; reasoningTokens: number };
  reasoningItemCount: number;
  continuationRounds: number;
}

interface AnswerSection {
  projection: ContextDiagnostics["projection"] | null;
  delivery: ContextDiagnostics["delivery"] | null;
  unknownCitationIds: string[];
}

interface StatsSection {
  runId: string;
  answerId: string;
  status: string;
  startedAt: string;
  durationMs: number;
  lastPhase: string;
  terminalReason?: string;
  timeline: ContextDiagnostics["run"] extends undefined ? never : NonNullable<ContextDiagnostics["run"]>["timeline"];
  omittedTimelineEvents?: number;
}

// ─── Builder ─────────────────────────────────────────────────────────────────

export function buildDiagnosticReportV3(diagnostics: ContextDiagnostics): DiagnosticReportV3 {
  const model = buildModelSection(diagnostics);
  const preflight = buildPreflightSection(diagnostics);
  const request = buildRequestSection(diagnostics);
  const reasoning = buildReasoningSection(diagnostics);
  const answer = buildAnswerSection(diagnostics);
  const stats = buildStatsSection(diagnostics);
  const findings = computeFindings({ model, preflight, request, reasoning, answer });

  return {
    schemaVersion: 3,
    question: diagnostics.question ?? "",
    findings,
    model,
    preflight,
    request,
    reasoning,
    answer,
    stats,
  };
}

// ─── Section builders ─────────────────────────────────────────────────────────

function buildModelSection(d: ContextDiagnostics): ModelSection {
  const agentic = d.agentic;
  const provenance: Record<string, string> = {};
  if (agentic?.capabilityProvenance) {
    Object.assign(provenance, agentic.capabilityProvenance);
  }

  return {
    name: d.modelName ?? "",
    apiFormat: d.modelApiFormat ?? null,
    executionStrategy: d.executionStrategy ?? "unknown",
    toolCapabilities: {
      calls: d.toolCapabilities?.calls ?? false,
      choiceRequired: d.toolCapabilities?.choiceRequired ?? false,
      choiceSpecific: d.toolCapabilities?.choiceSpecific ?? false,
      parallelCalls: d.toolCapabilities?.parallelCalls ?? false,
      provenance,
      probe: d.probeAudit
        ? {
          ranAt: d.probeAudit.ranAt,
          modelName: d.probeAudit.modelName,
          apiFormat: d.probeAudit.apiFormat,
          results: d.probeAudit.results,
          rawCapabilities: d.probeAudit.rawCapabilities,
        }
        : null,
    },
    reasoning: d.reasoning
      ? {
        protocol: d.reasoning.protocol,
        capabilitySource: d.reasoning.capabilitySource ?? null,
        configuredEffort: d.reasoning.configuredEffort ?? null,
        summaryRequested: d.reasoning.summaryRequested,
        summaryAvailable: d.reasoning.summaryAvailable,
      }
      : null,
  };
}

function buildPreflightSection(d: ContextDiagnostics): PreflightSection {
  const budget = d.budget ?? { usedTokens: 0, groups: [] };
  const limit = budget.limitTokens ?? null;
  const used = budget.usedTokens;

  const allSources = [
    ...(d.explicitSources ?? []),
    ...(d.mentionSources ?? []),
    ...(d.activeSources ?? []),
  ];

  return {
    index: d.index
      ? {
        status: d.index.status,
        available: d.index.available,
        isStale: d.index.isStale ?? false,
        indexedFiles: d.index.indexedFiles ?? 0,
        ...(d.index.errorMessage ? { errorMessage: d.index.errorMessage } : {}),
      }
      : null,
    indexDescription: d.indexDescription
      ? { ...d.indexDescription }
      : null,
    context: {
      mode: d.contextMode ?? "include",
      sources: allSources,
      graph: d.graph ?? { enabled: false, source: "none", depth: 0, rootPaths: [], included: [], dropped: [], unresolved: [], limits: { maxForwardLinksPerRoot: 0, maxEmbedsPerRoot: 0, maxBacklinksPerRoot: 0, maxGraphCandidatesTotal: 0 } },
      budget: {
        limitTokens: limit,
        reservedOutputTokens: budget.reservedOutputTokens ?? null,
        usedTokens: used,
        utilizationPct: limit !== null && limit > 0 ? Math.round((used / limit) * 100 * 10) / 10 : null,
        groups: budget.groups,
      },
    },
    warnings: d.warnings ?? [],
  };
}

function buildRequestSection(d: ContextDiagnostics): RequestSection {
  const agentic = d.agentic;
  const retrieval = d.retrieval ?? { queryVariants: [], includedChunkIds: [], droppedChunkIds: [], filteredSourcePaths: [] };
  const rankedChunks = retrieval.rankedChunks ?? [];

  // Compute score stats from ranked chunks
  let scoreStats: RequestSection["retrieval"] extends null ? never : NonNullable<RequestSection["retrieval"]>["scoreStats"] = null;
  if (rankedChunks.length > 0) {
    const scores = rankedChunks.map((c) => c.score);
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
    const threshold = null; // planner doesn't expose a score cutoff threshold directly
    scoreStats = { min, max, avg, threshold };
  }

  return {
    searchMode: d.searchMode ?? "unknown",
    agenticPolicy: {
      policyReason: agentic?.policyReason ?? "unknown",
      requiredTools: agentic?.requiredTools ?? [],
      bootstrapChoice: agentic?.bootstrapChoice ?? null,
    },
    retrieval: {
      queryVariants: retrieval.queryVariants,
      filteredSourcePaths: retrieval.filteredSourcePaths,
      rankedChunks: rankedChunks.map((c) => ({
        id: c.id,
        path: c.path,
        rank: c.rank,
        score: c.score,
        status: c.status,
        ...(c.reason ? { reason: c.reason } : {}),
        ...(c.dropReason ? { dropReason: c.dropReason } : {}),
      })),
      includedChunkIds: retrieval.includedChunkIds,
      droppedChunkIds: retrieval.droppedChunkIds,
      scoreStats,
    },
    web: d.web ?? null,
    evidencePlanner: d.evidencePlanner ?? null,
  };
}

function buildReasoningSection(d: ContextDiagnostics): ReasoningSection {
  const agentic = d.agentic;
  const tools = d.tools ?? [];

  // Build per-round breakdown from phases + tool calls tagged with round
  let rounds: AgenticLoopRound[] = [];
  if (agentic && agentic.phases && agentic.phases.length > 0) {
    const segments = agentic.reasoningSegments ?? [];
    rounds = agentic.phases.map((phase, index) => {
      const roundNumber = index + 1;
      const roundCalls = tools.filter((t) => t.round === roundNumber);
      const roundSegments = segments
        .filter((segment) => segment.round === roundNumber)
        .map((segment) => ({ segmentId: segment.segmentId, chars: segment.chars }));
      return {
        round: roundNumber,
        phase,
        toolCalls: roundCalls,
        reasoningSegments: roundSegments,
        hadTextOutput: roundCalls.length === 0, // heuristic: no tool calls means text round
        classification: null,
      };
    });
  }

  return {
    attempts: (d.attempts ?? []).map((a) => ({
      attempt: a.attempt,
      protocol: a.protocol,
      status: a.status,
      outputEmitted: a.outputEmitted,
      ...(a.errorCode ? { errorCode: a.errorCode } : {}),
      ...(a.fallbackDecision ? { fallbackDecision: a.fallbackDecision } : {}),
    })),
    stream: d.stream ?? null,
    agenticLoop: agentic
      ? {
        totalRounds: agentic.rounds,
        totalCalls: agentic.totalCalls,
        duplicateCalls: agentic.duplicateCalls,
        satisfiedTools: agentic.satisfiedTools,
        repairedTools: agentic.repairedTools,
        ...(agentic.fallbackReason ? { fallbackReason: agentic.fallbackReason } : {}),
        stopReasons: agentic.stopReasons ?? [],
        budgets: agentic.budgets ?? null,
        rounds,
      }
      : null,
    tokens: d.reasoning
      ? {
        inputTokens: d.reasoning.inputTokens,
        outputTokens: d.reasoning.outputTokens,
        reasoningTokens: d.reasoning.reasoningTokens,
      }
      : { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
    reasoningItemCount: d.reasoning?.reasoningItemCount ?? 0,
    continuationRounds: d.reasoning?.continuationRounds ?? 0,
  };
}

function buildAnswerSection(d: ContextDiagnostics): AnswerSection {
  return {
    projection: d.projection ?? null,
    delivery: d.delivery ?? null,
    unknownCitationIds: d.agentic?.unknownCitationIds ?? [],
  };
}

function buildStatsSection(d: ContextDiagnostics): StatsSection {
  const run = d.run;
  if (!run) {
    return {
      runId: "",
      answerId: "",
      status: "unknown",
      startedAt: "",
      durationMs: 0,
      lastPhase: "",
      timeline: [],
    };
  }
  return {
    runId: run.runId,
    answerId: run.answerId,
    status: run.status,
    startedAt: run.startedAt,
    durationMs: run.durationMs,
    lastPhase: run.lastPhase,
    ...(run.terminalReason ? { terminalReason: run.terminalReason } : {}),
    timeline: run.timeline,
    ...(run.omittedTimelineEvents ? { omittedTimelineEvents: run.omittedTimelineEvents } : {}),
  };
}

// ─── Findings engine ──────────────────────────────────────────────────────────

interface ReportSections {
  model: ModelSection;
  preflight: PreflightSection;
  request: RequestSection;
  reasoning: ReasoningSection;
  answer: AnswerSection;
}

function computeFindings(sections: ReportSections): FindingsSection {
  const findings: Finding[] = [];
  const { model, preflight, request, reasoning, answer } = sections;

  // error: tool-calls-blocked
  if (model.toolCapabilities.calls === false && model.executionStrategy !== "eager-forced") {
    findings.push({
      severity: "error",
      code: "tool-calls-blocked",
      title: "Tool calls unavailable for this model",
      detail: "The model does not support tool calling. Agentic research requires tool calls. Run the capability probe in Settings to check support, or set tool capabilities manually.",
      affectedSection: "model",
      evidence: { calls: false, provenance: model.toolCapabilities.provenance },
    });
  }

  // error: agentic-policy-fallback
  if (request.agenticPolicy.policyReason !== "eligible" && request.agenticPolicy.policyReason !== "forced-eager") {
    findings.push({
      severity: "error",
      code: "agentic-policy-fallback",
      title: `Agentic mode blocked: ${request.agenticPolicy.policyReason}`,
      detail: `The research request fell back to deterministic mode because: ${request.agenticPolicy.policyReason}. Check model capabilities and search provider configuration.`,
      affectedSection: "request",
      evidence: { policyReason: request.agenticPolicy.policyReason },
    });
  }

  // error: mandatory-tool-unsatisfied
  if (reasoning.agenticLoop) {
    const unsatisfied = reasoning.agenticLoop.satisfiedTools !== undefined
      ? request.agenticPolicy.requiredTools.filter(
        (t) => !reasoning.agenticLoop!.satisfiedTools.includes(t),
      )
      : [];
    if (unsatisfied.length > 0) {
      findings.push({
        severity: "error",
        code: "mandatory-tool-unsatisfied",
        title: "Required tools were not satisfied",
        detail: `The agentic loop finished without satisfying required tools: ${unsatisfied.join(", ")}. Check tool availability and model behavior.`,
        affectedSection: "reasoning",
        evidence: { unsatisfied, satisfiedTools: reasoning.agenticLoop.satisfiedTools, fallbackReason: reasoning.agenticLoop.fallbackReason },
      });
    }
  }

  // warning: all-chunks-dropped
  if (request.retrieval) {
    const ranked = request.retrieval.rankedChunks;
    if (ranked.length > 0 && ranked.every((c) => c.status === "dropped")) {
      findings.push({
        severity: "warning",
        code: "all-chunks-dropped",
        title: "All retrieved chunks were dropped by the evidence planner",
        detail: "Every chunk returned by the index was dropped. Check score thresholds, evidence planner policy, and budget settings.",
        affectedSection: "request",
        evidence: { droppedCount: ranked.length, policyReason: request.evidencePlanner?.budget.policy },
      });
    }
  }

  // warning: low-retrieval-scores
  if (request.retrieval?.scoreStats) {
    const { avg, threshold } = request.retrieval.scoreStats;
    if (threshold !== null && avg < threshold) {
      findings.push({
        severity: "warning",
        code: "low-retrieval-scores",
        title: "Average retrieval score is below threshold",
        detail: `Mean score ${avg.toFixed(3)} is below the threshold ${threshold.toFixed(3)}. The retrieved chunks may not be relevant. Consider expanding the index or rephrasing the query.`,
        affectedSection: "request",
        evidence: { avg, threshold, min: request.retrieval.scoreStats.min, max: request.retrieval.scoreStats.max },
      });
    }
  }

  // warning: index-files-zero-but-chunks-found
  if (
    preflight.index &&
    (preflight.index.indexedFiles === 0) &&
    (request.retrieval?.rankedChunks.length ?? 0) > 0
  ) {
    findings.push({
      severity: "warning",
      code: "index-files-zero-but-chunks-found",
      title: "Index reports 0 files but retrieval returned chunks",
      detail: "The index status shows indexedFiles=0, yet retrieval found chunks. This may indicate a stale index status counter. Re-index the vault to resolve.",
      affectedSection: "preflight",
      evidence: { indexedFiles: 0, chunksFound: request.retrieval?.rankedChunks.length },
    });
  }

  // warning: agentic-loop-zero-tool-calls
  if (
    reasoning.agenticLoop &&
    reasoning.agenticLoop.totalCalls === 0 &&
    reasoning.agenticLoop.totalRounds > 0
  ) {
    findings.push({
      severity: "warning",
      code: "agentic-loop-zero-tool-calls",
      title: "Agentic loop ran but made no tool calls",
      detail: "The model completed all rounds without calling any tools. The answer may be based on context alone, without retrieval.",
      affectedSection: "reasoning",
      evidence: { rounds: reasoning.agenticLoop.totalRounds, totalCalls: 0 },
    });
  }

  // warning: context-near-limit
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


  // warning: stream-terminal-missing
  if (reasoning.stream && !reasoning.stream.terminalEventObserved) {
    findings.push({
      severity: "warning",
      code: "stream-terminal-missing",
      title: "Stream ended without a terminal event",
      detail: "The model's streaming response did not produce a recognized terminal event (done/stop). The response may be truncated.",
      affectedSection: "reasoning",
      evidence: { terminalEventObserved: false, frameCount: reasoning.stream.frameCount },
    });
  }

  // info: unknown-citations
  if (answer.unknownCitationIds.length > 0) {
    findings.push({
      severity: "info",
      code: "unknown-citations",
      title: "Answer contains citation IDs not found in evidence",
      detail: `The model cited ${answer.unknownCitationIds.length} ID(s) that do not correspond to any retrieved evidence chunk. These citations are dropped from the final answer.`,
      affectedSection: "answer",
      evidence: { ids: answer.unknownCitationIds },
    });
  }

  // info: index-stale
  if (preflight.index?.isStale) {
    findings.push({
      severity: "info",
      code: "index-stale",
      title: "Index is stale",
      detail: "The vault index has not been refreshed since files were modified. Retrieval results may not reflect recent changes. Re-index to update.",
      affectedSection: "preflight",
      evidence: { isStale: true },
    });
  }

  // Sort: errors first, then warnings, then info
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
