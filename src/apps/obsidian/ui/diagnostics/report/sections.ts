import { ContextDiagnostics } from "@core/diagnostics";
import {
  ThinkingLoopRound,
  AnswerSection,
  ModelSection,
  PreflightSection,
  ReasoningSection,
  RequestSection,
  StatsSection,
} from "./types";

export function buildModelSection(d: ContextDiagnostics): ModelSection {
  const thinking = d.thinking;
  const provenance: Record<string, string> = {};
  const recordedProvenance = d.capabilityProvenance ?? thinking?.capabilityProvenance;
  if (recordedProvenance) {
    Object.assign(provenance, recordedProvenance);
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

export function buildPreflightSection(d: ContextDiagnostics): PreflightSection {
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
    indexDescription: d.indexDescription ? { ...d.indexDescription } : null,
    context: {
      mode: d.contextMode ?? "include",
      sources: allSources,
      graph: d.graph ?? {
        enabled: false,
        source: "none",
        depth: 0,
        rootPaths: [],
        included: [],
        dropped: [],
        unresolved: [],
        limits: {
          maxForwardLinksPerRoot: 0,
          maxEmbedsPerRoot: 0,
          maxBacklinksPerRoot: 0,
          maxGraphCandidatesTotal: 0,
        },
      },
      budget: {
        limitTokens: limit,
        reservedOutputTokens: budget.reservedOutputTokens ?? null,
        usedTokens: used,
        utilizationPct:
          limit !== null && limit > 0 ? Math.round((used / limit) * 100 * 10) / 10 : null,
        groups: budget.groups,
      },
    },
    warnings: d.warnings ?? [],
  };
}

export function buildRequestSection(d: ContextDiagnostics): RequestSection {
  const thinking = d.thinking;
  const policyReason =
    thinking?.policyReason ?? (d.executionStrategy === "instant" ? "instant-selected" : "unknown");
  const retrieval = d.retrieval ?? {
    queryVariants: [],
    includedChunkIds: [],
    droppedChunkIds: [],
    filteredSourcePaths: [],
  };
  const rankedChunks = retrieval.rankedChunks ?? [];

  let scoreStats: RequestSection["retrieval"] extends null
    ? never
    : NonNullable<RequestSection["retrieval"]>["scoreStats"] = null;
  if (rankedChunks.length > 0) {
    const scores = rankedChunks.map((c) => c.score);
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
    const threshold = null;
    scoreStats = { min, max, avg, threshold };
  }

  return {
    searchMode: d.searchMode ?? "unknown",
    thinkingPolicy: {
      policyReason,
      requiredTools: thinking?.requiredTools ?? [],
      bootstrapChoice: thinking?.bootstrapChoice ?? null,
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

export function buildReasoningSection(d: ContextDiagnostics): ReasoningSection {
  const thinking = d.thinking;
  const tools = d.tools ?? [];

  let rounds: ThinkingLoopRound[] = [];
  if (thinking && thinking.phases && thinking.phases.length > 0) {
    const segments = thinking.reasoningSegments ?? [];
    const promptDeltas = thinking.promptDeltas ?? [];
    rounds = thinking.phases.map((phase, index) => {
      const roundNumber = index + 1;
      const roundCalls = tools.filter((t) => t.round === roundNumber);
      const roundSegments = segments
        .filter((segment) => segment.round === roundNumber)
        .map((segment) => ({ segmentId: segment.segmentId, chars: segment.chars }));
      return {
        round: roundNumber,
        phase,
        promptDelta: promptDeltas.find((delta) => delta.round === roundNumber) ?? null,
        toolCalls: roundCalls,
        reasoningSegments: roundSegments,
        hadTextOutput: roundCalls.length === 0,
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
    thinkingLoop: thinking
      ? {
          totalRounds: Math.max(
            thinking.rounds,
            new Set(tools.map((t) => t.round).filter((r): r is number => r !== undefined)).size,
          ),
          totalCalls: Math.max(thinking.totalCalls, tools.length),
          duplicateCalls: thinking.duplicateCalls,
          satisfiedTools: thinking.satisfiedTools,
          repairedTools: thinking.repairedTools,
          ...(thinking.fallbackReason ? { fallbackReason: thinking.fallbackReason } : {}),
          stopReasons: thinking.stopReasons ?? [],
          budgets: thinking.budgets ?? null,
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

export function buildAnswerSection(d: ContextDiagnostics): AnswerSection {
  return {
    projection: d.projection ?? null,
    delivery: d.delivery ?? null,
    unknownCitationIds: d.thinking?.unknownCitationIds ?? [],
    unverifiedCitations: d.thinking?.unverifiedCitations ?? [],
  };
}

export function buildStatsSection(d: ContextDiagnostics): StatsSection {
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
