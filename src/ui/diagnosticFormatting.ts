import { ContextDiagnostics } from "../shared/types";

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
  if (diagnostics.retrieval.filteredSourcePaths.length > 0) {
    lines.push(`${diagnostics.retrieval.filteredSourcePaths.length} retrieval filter path(s)`);
  }
  lines.push(...skillDiagnosticLines(diagnostics));

  const toolDiagnostics = diagnostics.tools ?? [];
  if (toolDiagnostics.length > 0) {
    const succeeded = toolDiagnostics.filter((tool) => tool.status === "success").length;
    const skipped = toolDiagnostics.filter((tool) => tool.status === "skipped").length;
    lines.push(
      `${succeeded} tool call(s) completed${skipped > 0 ? `, ${skipped} skipped` : ""}`,
    );
  }
  for (const warning of diagnostics.warnings ?? []) {
    lines.push(`Warning: ${warning}`);
  }

  return lines;
}
