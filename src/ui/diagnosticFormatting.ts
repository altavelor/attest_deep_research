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
