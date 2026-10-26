import type { SubAgentModelSnapshot } from "./modelSnapshot";
import type { NormalizedUsage, SubAgentCommand } from "./sessionModel";

export type { SubAgentModelSnapshot };

export type SubAgentPromptRole = "system" | "user" | "assistant" | "tool";

export interface SubAgentPromptMessage {
  role: SubAgentPromptRole;
  content: string;
}

export type SubAgentInitialPromptState = "captured" | "not-started" | "unavailable" | "evicted";

export interface SubAgentInitialPrompt {
  runId: string;
  capturedAt: string | null;
  state: SubAgentInitialPromptState;
  messages: readonly SubAgentPromptMessage[];
  redacted: boolean;
  truncated: boolean;
  unavailableReason?: string;
}

export type SubAgentPayloadState = "captured" | "disabled" | "evicted" | "truncated";

export interface SubAgentWorkflowItem {
  id: string;
  sessionId: string;
  runId: string;
  name: string;
  label: string;
  sequence: number;
  round: number;
  status: "pending" | "complete" | "failed";
  startedAt: string;
  completedAt?: string;
  args?: Record<string, unknown>;
  resultSummary?: string;
  resultJson?: string;
  badge?: { text: string; tooltip?: string };
  payloadState: SubAgentPayloadState;
}

export type SubAgentObservationEvent =
  | {
      type: "model-started";
      runId: string;
      model: SubAgentModelSnapshot;
      prompt: SubAgentInitialPrompt;
    }
  | { type: "usage"; runId: string; requestId: string; usage: NormalizedUsage; final: boolean }
  | { type: "tool-start" | "tool-end"; item: SubAgentWorkflowItem }
  | { type: "phase"; runId: string; phase: string; occurredAt: string };

export interface SubAgentDispatchEntry {
  eventKey: string;
  sessionId: string;
  runId: string;
  parentRunId: string;
  body: string;
  createdAt: string;
  commandKind: SubAgentCommand["type"] | "retry";
  attempt: number;
  sequence: number;
}

export type SubAgentNoticeKind =
  | "created"
  | "queued"
  | "not-started"
  | "finished"
  | "partial"
  | "failed"
  | "stopped"
  | "interrupted"
  | "import-failed"
  | "closed"
  | "batch";

export interface SubAgentNoticeEntry {
  eventKey: string;
  parentRunId: string;
  description: string;
  createdAt: string;
  sessionId: string | null;
  batchId?: string;
  runId: string | null;
  sequence: number;
  kind: SubAgentNoticeKind;
  durationMs?: number;
  usage?: NormalizedUsage;
  modelLabel?: string;
  reasonCode?: string;
  replyExcerpt?: string;
  replyTruncated?: boolean;
  batch?: { total: number; done: number; running: number; failed: number };
  closedCount?: number;
}

export const SUB_AGENT_REDACTION_MARKER = "[redacted]";
export const MAX_PROMPT_SNAPSHOT_CHARS = 64 * 1024;
export const MAX_TOOL_PAYLOAD_CHARS = 32 * 1024;
export const MAX_RUN_PAYLOAD_CHARS = 256 * 1024;
export const MAX_REPLY_EXCERPT_BYTES = 4 * 1024;

const SAFE_CODE = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const TOKEN_FIELDS = [
  "inputTokens",
  "outputTokens",
  "reasoningTokens",
  "cachedInputTokens",
  "cacheCreationInputTokens",
] as const;

/**
 * Cuts already-redacted text to at most max characters, or max UTF-8 bytes without
 * splitting a code point. A redaction marker that the limit would split is dropped
 * entirely, so the cut never leaves part of a marker.
 */
export function capRedactedText(
  text: string,
  max: number,
  unit: "chars" | "utf8" = "chars",
): { text: string; truncated: boolean } {
  let cut = unit === "chars" ? Math.min(text.length, max) : utf8Cut(text, max);
  if (cut >= text.length) return { text, truncated: false };
  const from = Math.max(0, cut - SUB_AGENT_REDACTION_MARKER.length + 1);
  const straddling = text.indexOf(SUB_AGENT_REDACTION_MARKER, from);
  if (straddling !== -1 && straddling < cut) cut = straddling;
  return { text: text.slice(0, cut), truncated: true };
}

function utf8Cut(text: string, maxBytes: number): number {
  let bytes = 0;
  let index = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    if (bytes > maxBytes) return index;
    index += char.length;
  }
  return index;
}

/** Returns the code when it is a short lowercase safe code, otherwise "unknown". */
export function safeSubAgentCode(value: string | null | undefined): string {
  return value && SAFE_CODE.test(value) ? value : "unknown";
}

/** Returns the notice text of an interrupted run for its safe reason code. */
export function subAgentInterruptedText(reasonCode: string): string {
  if (reasonCode === "plugin-unload" || reasonCode === "crash-recovery") {
    return "Obsidian was closed or reloaded";
  }
  if (reasonCode === "timeout" || reasonCode === "deadline") return "The sub-agent ran out of time";
  return "The sub-agent was stopped";
}

/** Returns the reported total of one request: the provider total, or input plus output when both are known. */
function totalOf(usage: NormalizedUsage): number | undefined {
  if (validCount(usage.totalTokens)) return usage.totalTokens;
  if (validCount(usage.inputTokens) && validCount(usage.outputTokens)) {
    return usage.inputTokens + usage.outputTokens;
  }
  return undefined;
}

/**
 * Sums the usage of distinct requests. Only reported finite nonnegative token counts are
 * added, reasoning and cache counts stay components of the total, and a request without
 * a known total makes the sum incomplete; missing fields stay missing.
 */
export function mergeSubAgentUsage(entries: readonly NormalizedUsage[]): {
  usage: NormalizedUsage;
  incomplete: boolean;
} {
  const usage: NormalizedUsage = {
    requestCount: 0,
    modelRounds: 0,
    toolCalls: 0,
    durationMs: 0,
    source: "unavailable",
  };
  let incomplete = false;
  for (const entry of entries) {
    for (const key of ["requestCount", "modelRounds", "toolCalls", "durationMs"] as const) {
      if (validCount(entry[key])) usage[key] += entry[key];
    }
    for (const key of TOKEN_FIELDS) {
      const value = entry[key];
      if (validCount(value)) usage[key] = (usage[key] ?? 0) + value;
    }
    const total = totalOf(entry);
    if (total === undefined) incomplete = true;
    else usage.totalTokens = (usage.totalTokens ?? 0) + total;
    if (entry.source === "provider" || usage.source === "provider") usage.source = "provider";
    else if (entry.source === "estimated") usage.source = "estimated";
  }
  return { usage, incomplete };
}

/** True when the value is a complete model snapshot with nonempty string fields. */
export function isSubAgentModelSnapshot(value: unknown): value is SubAgentModelSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (["profileId", "providerId", "modelId", "label"] as const).every(
    (key) => typeof row[key] === "string" && (row[key] as string).length > 0,
  );
}

/** Builds the idempotency key of a main-visible notice from its full identity and kind. */
export function subAgentNoticeKey(
  chatId: string,
  parentRunId: string,
  sessionId: string | null,
  runId: string | null,
  kind: SubAgentNoticeKind,
): string {
  if (kind === "closed") return `notice:${parentRunId}:closed`;
  return `notice:${chatId}:${parentRunId}:${sessionId ?? "-"}:${runId ?? "-"}:${kind}`;
}

/** Builds the idempotency key of a dispatch entry from the accepted command identity. */
export function subAgentDispatchKey(
  chatId: string,
  parentRunId: string,
  sessionId: string,
  runId: string,
): string {
  return `dispatch:${chatId}:${parentRunId}:${sessionId}:${runId}`;
}

function validCount(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
