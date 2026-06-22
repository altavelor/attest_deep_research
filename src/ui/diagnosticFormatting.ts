import { ContextDiagnostics } from "../shared/types";

export interface DiagnosticReportViewModel {
  title: string;
  identity: { runId?: string; answerId?: string; schemaVersion: number };
  outcome: { status: string; likelyLayer?: string };
  findings: Array<{
    severity: "info" | "warning" | "error";
    code: string;
    likelyLayer: string;
    message: string;
  }>;
  metrics: Array<{ label: string; value: string }>;
  sections: Array<{ id: string; title: string; rows: Array<{ label: string; value: string }> }>;
  timeline: Array<{ offsetMs: number; type: string; detail?: string }>;
  rawReport: string;
}

export function buildDiagnosticReportViewModel(
  diagnostics: ContextDiagnostics,
): DiagnosticReportViewModel {
  const findings = diagnosticFindings(diagnostics);
  const sections: DiagnosticReportViewModel["sections"] = [];
  if (diagnostics.run) {
    sections.push({
      id: "run",
      title: "Agent run",
      rows: [
        { label: "Run ID", value: diagnostics.run.runId },
        { label: "Status", value: diagnostics.run.status },
        { label: "Last phase", value: diagnostics.run.lastPhase },
        { label: "Duration", value: formatMilliseconds(diagnostics.run.durationMs) },
      ],
    });
  }
  if (diagnostics.stream) {
    sections.push({
      id: "stream",
      title: "Reasoning stream",
      rows: [
        { label: "Protocol", value: diagnostics.stream.protocol },
        { label: "Dialects", value: diagnostics.stream.observedDialects.join(", ") || "none" },
        { label: "Frames", value: String(diagnostics.stream.frameCount) },
        { label: "Reasoning deltas", value: String(diagnostics.stream.reasoningDeltaCount) },
        { label: "Text deltas", value: String(diagnostics.stream.textDeltaCount) },
        { label: "Ignored events", value: String(diagnostics.stream.ignoredEventCount) },
      ],
    });
  }
  if (diagnostics.projection) {
    sections.push({
      id: "projection",
      title: "Research projection",
      rows: [
        { label: "Reasoning segments", value: String(diagnostics.projection.reasoningSegments) },
        { label: "Checkpoints", value: String(diagnostics.projection.checkpointsCreated) },
        { label: "Final commits", value: String(diagnostics.projection.finalAnswersCommitted) },
      ],
    });
  }
  if (diagnostics.delivery) {
    sections.push({
      id: "delivery",
      title: "UI delivery and persistence",
      rows: [
        { label: "Events received", value: String(diagnostics.delivery.projectorEventsReceived) },
        { label: "UI patches", value: String(diagnostics.delivery.uiPatchesApplied) },
        { label: "Coalesced updates", value: String(diagnostics.delivery.coalescedUpdates) },
        { label: "Persistence", value: diagnostics.delivery.persistenceStatus },
      ],
    });
  }
  sections.push({
    id: "context",
    title: "Context and retrieval",
    rows: [
      { label: "Mode", value: diagnostics.contextMode },
      { label: "Used tokens", value: String(diagnostics.budget.usedTokens) },
      { label: "Tool calls", value: String(diagnostics.tools.length) },
      { label: "Warnings", value: diagnostics.warnings.join("\n") || "none" },
    ],
  });
  return {
    title: "Ixplorer diagnostic report",
    identity: {
      runId: diagnostics.run?.runId,
      answerId: diagnostics.run?.answerId,
      schemaVersion: diagnostics.reportSchemaVersion ?? 1,
    },
    outcome: {
      status: diagnostics.run?.status ?? "unknown",
      likelyLayer: findings[0]?.likelyLayer,
    },
    findings,
    metrics: [
      { label: "Execution strategy", value: diagnostics.executionStrategy ?? "unknown" },
      { label: "Context tokens", value: String(diagnostics.budget.usedTokens) },
      { label: "Warnings", value: String(diagnostics.warnings.length) },
    ],
    sections,
    timeline:
      diagnostics.run?.timeline.map((event) => ({
        offsetMs: event.offsetMs,
        type: event.type,
        detail: [event.status, event.reason].filter(Boolean).join(" · ") || undefined,
      })) ?? [],
    rawReport: formatDiagnosticReport(diagnostics),
  };
}

function diagnosticFindings(
  diagnostics: ContextDiagnostics,
): DiagnosticReportViewModel["findings"] {
  const findings: DiagnosticReportViewModel["findings"] = [];
  const stream = diagnostics.stream;
  const projection = diagnostics.projection;
  const delivery = diagnostics.delivery;
  if (
    stream &&
    stream.reasoningDeltaCount > 0 &&
    (!projection || projection.reasoningSegments === 0)
  ) {
    findings.push({
      severity: "error",
      code: "reasoning-not-projected",
      likelyLayer: "research-progress-projector",
      message:
        "Reasoning reached the normalized stream but no research-progress segment was created.",
    });
  } else if (
    projection &&
    projection.reasoningSegments > 0 &&
    (!delivery || delivery.uiPatchesApplied === 0)
  ) {
    findings.push({
      severity: "error",
      code: "reasoning-not-rendered",
      likelyLayer: "ui-delivery",
      message: "Reasoning was projected but no UI patch was applied.",
    });
  }
  if (stream && !stream.terminalEventObserved) {
    findings.push({
      severity: "warning",
      code: "terminal-event-missing",
      likelyLayer: "stream-framing",
      message: "The transport ended without a recognized terminal event.",
    });
  }
  return findings;
}

function formatMilliseconds(value: number): string {
  return value < 1_000 ? `${value} ms` : `${(value / 1_000).toFixed(2)} s`;
}

export function skillDiagnosticLines(diagnostics: ContextDiagnostics): string[] {
  const skills = diagnostics.skills;
  if (!skills) {
    return [];
  }

  const lines = [`${skills.discoveredCount} skill(s) discovered`];
  if (skills.selectedName) {
    lines.push(
      `Skill: ${skills.selectedName} (${skills.selectionMode}, ${skills.loadMode}, ${skills.loadStatus})`,
    );
  }
  if (skills.loadedCharacters !== undefined || skills.loadedTokens !== undefined) {
    lines.push(
      `Skill size: ${(skills.loadedCharacters ?? 0).toLocaleString("en-US")} chars / ${(skills.loadedTokens ?? 0).toLocaleString("en-US")} tokens`,
    );
  }
  for (const warning of skills.warnings) {
    lines.push(`Skill warning: ${warning.path} · ${warning.reason}`);
  }
  if (skills.selectorWarning) {
    lines.push(`Skill selector warning: ${skills.selectorWarning}`);
  }
  if (skills.loadError) {
    lines.push(`Skill load error: ${skills.loadError}`);
  }
  return lines;
}

export function retrievalDiagnosticLines(diagnostics: ContextDiagnostics): string[] {
  const lines: string[] = [];
  if (diagnostics.index) {
    const details = [diagnostics.index.available ? "available" : "unavailable"];
    if (diagnostics.index.isStale) {
      details.push("stale");
    }
    lines.push(`Index: ${diagnostics.index.status} (${details.join(", ")})`);
  }
  if (diagnostics.retrieval.queryVariants.length > 0) {
    lines.push(`Query variants: ${diagnostics.retrieval.queryVariants.join("; ")}`);
  }
  for (const path of diagnostics.retrieval.filteredSourcePaths) {
    lines.push(`Filter: ${path} · source-path-filter`);
  }
  for (const chunk of diagnostics.retrieval.rankedChunks?.slice(0, 10) ?? []) {
    lines.push(
      [`#${chunk.rank} ${chunk.path}`, chunk.id, chunk.score.toFixed(3), chunk.status, chunk.reason]
        .filter(Boolean)
        .join(" · "),
    );
  }
  return lines;
}

export function webDiagnosticLines(diagnostics: ContextDiagnostics): string[] {
  const web = diagnostics.web;
  if (!web) {
    return [];
  }

  const queryConstruction =
    web.queryStrategy === "direct"
      ? "use the original question unchanged"
      : web.queryStrategy === "planned"
        ? "model-generated query plan from the original question"
        : "use the original question after query planning failed";
  const lines = [
    `Original question: ${web.originalQuestion}`,
    `Query strategy: ${web.queryStrategy}`,
    `Query construction: ${queryConstruction}`,
    ...web.queries.map((query, index) => `Query ${index + 1}: ${query}`),
    ...web.requests.map(
      (request, index) =>
        `Search request ${index + 1}: ${request.query} · limit ${request.limit}, max fetches ${request.maxFetches}`,
    ),
    "Processing: normalize URL → deduplicate → rank → apply web limit → evidence planner → final prompt",
    "Ranking: query-token overlap × 10 + provider-rank bonus",
  ];

  for (const result of web.results) {
    const decision =
      result.status === "included"
        ? `included (prompt #${result.promptOrder})`
        : result.status === "dropped"
          ? `dropped (${result.reason ?? "unspecified"})`
          : "candidate";
    lines.push(
      `#${result.processingRank ?? "-"} ${result.title} · ${decision} · provider rank ${result.providerRank} · relevance ${result.relevanceScore.toFixed(3)} · ${result.textSource} · ${result.textCharacters.toLocaleString("en-US")} chars / ${result.estimatedTokens.toLocaleString("en-US")} tokens`,
      `  URL: ${result.url}`,
      `  Query: ${result.query}`,
      `  Preview: ${result.textPreview}`,
    );
  }

  lines.push(
    `Final prompt web section: ${web.finalPrompt.includedChunkIds.length} item(s), ${web.finalPrompt.usedTokens.toLocaleString("en-US")} evidence-text tokens`,
    ...web.finalPrompt.includedChunkIds.map(
      (chunkId, index) => `Prompt web #${index + 1}: ${chunkId}`,
    ),
  );

  return lines;
}

export function formatDiagnosticReport(diagnostics: ContextDiagnostics): string {
  const summaryLines = diagnosticSummaryLines(diagnostics);
  const webLines = webDiagnosticLines(diagnostics);
  const retrievalLines = retrievalDiagnosticLines(diagnostics);
  const sections = ["Diagnostic report", "", "Context used", ...summaryLines];

  if (webLines.length > 0) {
    sections.push("", "Web research", ...webLines);
  }

  if (retrievalLines.length > 0) {
    sections.push("", "Retrieval diagnostics", ...retrievalLines);
  }

  sections.push("", "Debug details", JSON.stringify(diagnostics, null, 2));
  return sections.join("\n");
}

function diagnosticSummaryLines(diagnostics: ContextDiagnostics): string[] {
  const explicitSources = [
    ...(diagnostics.explicitSources ?? []),
    ...(diagnostics.mentionSources ?? []),
    ...(diagnostics.activeSources ?? []),
  ];
  const includedExplicit = explicitSources.filter((source) => source.status === "included").length;
  const plannerPolicy = diagnostics.evidencePlanner?.budget.policy;
  const webBudget = diagnostics.evidencePlanner?.budget.groups.find(
    (group) => group.name === "web",
  );
  const lines = [
    ...(diagnostics.executionStrategy
      ? [`Execution strategy: ${diagnostics.executionStrategy.replace(/-/g, " ")}`]
      : []),
    `Mode: ${
      plannerPolicy === "web-only"
        ? "web only"
        : diagnostics.contextMode === "filter"
          ? "filter retrieval"
          : "include attached files"
    }`,
    `${includedExplicit} explicit source(s) included`,
    `${diagnostics.retrieval.includedChunkIds.length} retrieved chunk(s) used`,
  ];

  if (webBudget && (webBudget.includedItems ?? 0) > 0) {
    lines.push(
      `${webBudget.includedItems} web source(s) used (${webBudget.usedTokens.toLocaleString("en-US")} tokens)`,
    );
  }

  if (diagnostics.graph?.included.length > 0) {
    lines.push(`${diagnostics.graph.included.length} linked note(s) used`);
  }
  if (diagnostics.agentic) {
    lines.push(
      `Agentic policy: ${diagnostics.agentic.policyReason} · ${diagnostics.agentic.rounds} round(s), ${diagnostics.agentic.totalCalls} call(s)`,
      `Mandatory tools: ${diagnostics.agentic.requiredTools.join(", ") || "none"}`,
      `Satisfied tools: ${diagnostics.agentic.satisfiedTools.join(", ") || "none"}`,
    );
    if (diagnostics.agentic.fallbackReason) {
      lines.push(`Agentic fallback: ${diagnostics.agentic.fallbackReason}`);
    }
    if (diagnostics.agentic.unknownCitationIds?.length) {
      lines.push(
        `Unknown citation IDs ignored: ${diagnostics.agentic.unknownCitationIds.join(", ")}`,
      );
    }
  }
  if (diagnostics.retrieval.filteredSourcePaths.length > 0) {
    lines.push(`${diagnostics.retrieval.filteredSourcePaths.length} retrieval filter path(s)`);
  }
  lines.push(...skillDiagnosticLines(diagnostics));

  const toolDiagnostics = diagnostics.tools ?? [];
  if (toolDiagnostics.length > 0) {
    const succeeded = toolDiagnostics.filter((tool) => tool.status === "success").length;
    const skipped = toolDiagnostics.filter((tool) => tool.status === "skipped").length;
    lines.push(`${succeeded} tool call(s) completed${skipped > 0 ? `, ${skipped} skipped` : ""}`);
  }
  for (const warning of diagnostics.warnings ?? []) {
    lines.push(`Warning: ${warning}`);
  }

  return lines;
}
