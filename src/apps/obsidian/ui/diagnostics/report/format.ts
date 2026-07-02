// Pure formatting/aggregation helpers for the diagnostic report views.
// Kept free of DOM/markup so the round-summary logic is unit-testable.

import { ToolCallDiagnostic } from "@core/diagnostics";
import { AgenticLoopRound, DiagnosticReportV3 } from "./types";

export function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

export function formatDuration(ms: number): string {
  return ms < 1_000 ? `${ms} ms` : `${(ms / 1_000).toFixed(1)} s`;
}

/** True for a successful keyword search that surfaced zero results. */
export function isEmptySearchResult(call: ToolCallDiagnostic): boolean {
  if (call.status !== "success") return false;
  if (call.name !== "search_web" && call.name !== "search_index") return false;
  return typeof call.resultPreview === "string" && call.resultPreview.includes('"results":[]');
}

/** Provider hint embedded in a search result payload, if present. */
export function extractResultHint(call: ToolCallDiagnostic): string | null {
  const match = call.resultPreview?.match(/"hint"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (!match) return null;
  try {
    return JSON.parse(`"${match[1]}"`) as string;
  } catch {
    return match[1];
  }
}

export interface ToolCallGroup {
  name: string;
  count: number;
  failed: number;
  empty: number;
}

/** Aggregates a round's calls by tool name, preserving first-seen order. */
export function groupToolCalls(calls: ToolCallDiagnostic[]): ToolCallGroup[] {
  const groups = new Map<string, ToolCallGroup>();
  for (const call of calls) {
    const group = groups.get(call.name) ?? { name: call.name, count: 0, failed: 0, empty: 0 };
    group.count += 1;
    if (call.status === "failed") group.failed += 1;
    if (isEmptySearchResult(call)) group.empty += 1;
    groups.set(call.name, group);
  }
  return [...groups.values()];
}

/** One-line call summary for a collapsed round, e.g. "5× search_web ∅ · 2× fetch_web_page". */
export function toolCallSummary(calls: ToolCallDiagnostic[]): string {
  if (calls.length === 0) return "no tool calls";
  return groupToolCalls(calls)
    .map((group) => {
      const marks = [
        group.failed > 0 ? "✗" : null,
        group.empty === group.count && group.count > 0 ? "∅" : null,
      ].filter(Boolean).join("");
      return `${group.count}× ${group.name}${marks ? ` ${marks}` : ""}`;
    })
    .join(" · ");
}

export function reasoningChars(round: AgenticLoopRound): number {
  return round.reasoningSegments.reduce((sum, segment) => sum + segment.chars, 0);
}

/** Rounds worth auto-expanding: failures, spins, and the answer round. */
export function isNoteworthyRound(round: AgenticLoopRound): boolean {
  if (round.toolCalls.some((call) => call.status === "failed")) return true;
  if (round.toolCalls.length > 0 && round.toolCalls.every(isEmptySearchResult)) return true;
  return round.hadTextOutput;
}

export interface SummaryMetric {
  label: string;
  value: string;
}

/** Headline metrics for the summary strip. */
export function summaryMetrics(report: DiagnosticReportV3): SummaryMetric[] {
  const metrics: SummaryMetric[] = [];
  const loop = report.reasoning.agenticLoop;
  if (loop) {
    metrics.push({
      label: "Rounds",
      value: loop.budgets ? `${loop.totalRounds} / ${loop.budgets.maxRounds}` : String(loop.totalRounds),
    });
    metrics.push({
      label: "Tool calls",
      value: loop.duplicateCalls > 0 ? `${loop.totalCalls} (${loop.duplicateCalls} dup)` : String(loop.totalCalls),
    });
    if (loop.budgets) {
      metrics.push({
        label: "Result chars",
        value: `${formatCount(loop.budgets.usedResultChars)} / ${formatCount(loop.budgets.maxResultChars)}`,
      });
    }
  }
  if (report.stats.durationMs > 0) {
    metrics.push({ label: "Duration", value: formatDuration(report.stats.durationMs) });
  }
  const tokens = report.reasoning.tokens;
  if (tokens.inputTokens + tokens.outputTokens + tokens.reasoningTokens > 0) {
    metrics.push({
      label: "Tokens in / out / think",
      value: `${formatCount(tokens.inputTokens)} / ${formatCount(tokens.outputTokens)} / ${formatCount(tokens.reasoningTokens)}`,
    });
  }
  metrics.push({ label: "Context tokens", value: formatCount(report.preflight.context.budget.usedTokens) });
  return metrics;
}
