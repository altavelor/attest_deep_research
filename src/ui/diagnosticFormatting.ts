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

export function formatDiagnosticReport(diagnostics: ContextDiagnostics): string {
  const summaryLines = diagnosticSummaryLines(diagnostics);
  const retrievalLines = retrievalDiagnosticLines(diagnostics);
  const sections = ["Diagnostic report", "", "Context used", ...summaryLines];

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
  const lines = [
    `Mode: ${diagnostics.contextMode === "filter" ? "filter retrieval" : "include attached files"}`,
    `${includedExplicit} explicit source(s) included`,
    `${diagnostics.retrieval.includedChunkIds.length} retrieved chunk(s) used`,
  ];

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
