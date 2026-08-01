import {
  ChatToolCall,
  ToolEvent,
  ToolExecution as ResearchToolExecution,
  toolExecutionPayload,
} from "@core/agent";
import { DOWNLOAD_DOCUMENT_TOOL, SUB_AGENT_TOOL } from "@core/agent";
import { ToolManager } from "@application/tools/ToolManager";
import { ConcurrencyLimiter } from "./ToolConcurrencyPool";

export interface CachedExecution {
  ok: boolean;
  retryable: boolean;
  result: string;
  diagnostic?: Record<string, unknown>;
}

export function serializeExecution(execution: ResearchToolExecution<unknown>): CachedExecution {
  return {
    ok: execution.ok,
    retryable: execution.ok ? false : execution.error.retryable,
    result: JSON.stringify(toolExecutionPayload(execution)),
    ...(execution.diagnostic ? { diagnostic: execution.diagnostic } : {}),
  };
}

export function normalizedCallKey(call: Pick<ChatToolCall, "name" | "arguments">): string {
  return `${call.name}:${stableJson(call.arguments)}`;
}

export function extractEvidenceIds(result: string): string[] {
  const ids: string[] = [];
  const pattern = /"(?:evidenceId|chunkId)"\s*:\s*"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(result)) !== null) ids.push(match[1]);
  return ids;
}

export function contentBearingTool(name: string): boolean {
  return name === "read_note" || name === "get_active_note" || name === "fetch_web_page";
}

export function searchTool(name: string): boolean {
  return name === "search_web" || name === "search_index";
}

export function launchParallelToolPool(
  calls: ChatToolCall[],
  cache: Map<string, CachedExecution>,
  tools: ToolManager,
  signal: AbortSignal | undefined,
  onToolEvent: (id: string, event: ToolEvent) => void,
  subAgentLimit: number,
  toolLimit: number,
): Map<string, Promise<ResearchToolExecution<unknown>>> {
  const subAgentLimiter = new ConcurrencyLimiter(subAgentLimit);
  const toolLimiter = new ConcurrencyLimiter(toolLimit);
  const pool = new Map<string, Promise<ResearchToolExecution<unknown>>>();
  const launchedByKey = new Map<string, Promise<ResearchToolExecution<unknown>>>();
  for (const call of calls) {
    if (!parallelSafeTool(call.name)) continue;
    const key = normalizedCallKey(call);
    if (cache.has(key)) continue;
    const limiter = call.name === SUB_AGENT_TOOL ? subAgentLimiter : toolLimiter;
    const promise =
      launchedByKey.get(key) ??
      limiter.run(() =>
        tools.execute(call, { signal, emit: (event) => onToolEvent(call.id, event) }),
      );
    launchedByKey.set(key, promise);
    pool.set(call.id, promise);
  }
  return pool;
}

export function mutationTool(name: string): boolean {
  return name === "create_note" || name === "update_note" || name === "delete_note";
}

export function stableJson(value: Record<string, unknown>): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, canonicalize(child)]),
  );
}

function parallelSafeTool(name: string): boolean {
  return !mutationTool(name) && name !== DOWNLOAD_DOCUMENT_TOOL;
}
