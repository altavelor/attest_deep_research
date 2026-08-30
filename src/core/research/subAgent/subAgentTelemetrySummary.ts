import { INDEX_SEARCH_TOOL, MAP_SOURCES_TOOL, SUB_AGENT_TOOL, WEB_SEARCH_TOOL } from "@core/agent";
import type {
  SubAgentGroupSummary,
  SubAgentRunSummary,
  ToolCallDiagnostic,
} from "@core/diagnostics";

export interface SubAgentTelemetrySummaries {
  subAgents?: SubAgentRunSummary;
  mapSources?: SubAgentGroupSummary;
}

const DUPLICATE_RESULT_REASON = "duplicate-result-reused";

/**
 * Aggregates the per-call sub-agent telemetry of one run. A cache replay counts once:
 * it is skipped by its duplicate reason and again by run id. Sub-agents launched
 * through map_sources are summarized in their own namespace.
 */
export function summarizeSubAgentTelemetry(
  tools: readonly ToolCallDiagnostic[],
): SubAgentTelemetrySummaries {
  const direct = new Map<string, Record<string, unknown>>();
  const mapped = new Map<string, Record<string, unknown>>();
  let topLevelSearchCalls = 0;

  for (const call of tools) {
    if (call.reason === DUPLICATE_RESULT_REASON) continue;
    if (call.name === WEB_SEARCH_TOOL || call.name === INDEX_SEARCH_TOOL) topLevelSearchCalls += 1;
    if (call.name === SUB_AGENT_TOOL) {
      collect(direct, call.metadata);
    } else if (call.name === MAP_SOURCES_TOOL) {
      for (const record of nestedRecords(call.metadata)) collect(mapped, record);
    }
  }

  const subAgents = [...direct.values()];
  const mapSources = [...mapped.values()];
  return {
    ...(subAgents.length > 0
      ? {
          subAgents: {
            ...groupSummary(subAgents),
            topLevelSearchCalls,
            importedSources: sum(subAgents, "sourceCount"),
            droppedSources: sum(subAgents, "droppedSourceCount"),
          },
        }
      : {}),
    ...(mapSources.length > 0 ? { mapSources: groupSummary(mapSources) } : {}),
  };
}

function collect(records: Map<string, Record<string, unknown>>, metadata: unknown): void {
  const record = asRecord(metadata);
  const runId = record?.runId;
  if (!record || typeof runId !== "string" || runId.length === 0) return;
  if (!records.has(runId)) records.set(runId, record);
}

function nestedRecords(metadata: unknown): Record<string, unknown>[] {
  const entries = asRecord(metadata)?.mapSources;
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== undefined);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function groupSummary(records: readonly Record<string, unknown>[]): SubAgentGroupSummary {
  return {
    count: records.length,
    totalDurationMs: sum(records, "durationMs"),
    maxDurationMs: records.reduce((max, record) => Math.max(max, numeric(record, "durationMs")), 0),
    roundLimitHits: records.filter((record) => record.hitRoundLimit === true).length,
    synthesisFallbacks: records.filter((record) => record.usedSynthesisFallback === true).length,
    searchCalls: sum(records, "searchCalls"),
  };
}

function sum(records: readonly Record<string, unknown>[], key: string): number {
  return records.reduce((total, record) => total + numeric(record, key), 0);
}

function numeric(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}
