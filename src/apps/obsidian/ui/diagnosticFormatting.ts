import { ContextDiagnostics } from "@core/diagnostics";
import { buildDiagnosticReportV3 } from "./diagnosticReportV3";

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
  return JSON.stringify(buildDiagnosticReportV3(diagnostics), null, 2);
}
