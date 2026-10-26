import {
  capRedactedText,
  MAX_PROMPT_SNAPSHOT_CHARS,
  MAX_TOOL_PAYLOAD_CHARS,
  safeSubAgentCode,
  type SubAgentInitialPrompt,
  type SubAgentPromptMessage,
  type SubAgentWorkflowItem,
} from "./observationModel";

export type SubAgentRedactor = (text: string) => string;

const ROLES = new Set(["system", "user", "assistant", "tool"]);
const MAX_LABEL_CHARS = 200;
const MAX_SUMMARY_CHARS = 1_000;

export interface SubAgentToolCapture {
  item: SubAgentWorkflowItem;
  payloadChars: number;
}

/**
 * Builds the stored initial prompt of a run from untrusted messages: only role and text
 * content are kept, every content is redacted first and the whole snapshot is then capped
 * at 64 Ki characters, keeping the role of the message the limit cuts.
 */
export function sanitizeSubAgentPrompt(
  runId: string,
  capturedAt: string,
  messages: readonly unknown[],
  redact: SubAgentRedactor,
): SubAgentInitialPrompt {
  let remaining = MAX_PROMPT_SNAPSHOT_CHARS;
  let redacted = false;
  let truncated = false;
  const kept: SubAgentPromptMessage[] = [];
  for (const message of messages) {
    const row = (typeof message === "object" && message !== null ? message : {}) as Record<
      string,
      unknown
    >;
    if (typeof row.role !== "string" || !ROLES.has(row.role)) continue;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const raw = typeof row.content === "string" ? row.content : "";
    const clean = redact(raw);
    redacted ||= clean !== raw;
    const capped = capRedactedText(clean, remaining);
    truncated ||= capped.truncated;
    remaining = capped.truncated ? 0 : remaining - capped.text.length;
    kept.push({ role: row.role as SubAgentPromptMessage["role"], content: capped.text });
  }
  return { runId, capturedAt, state: "captured", messages: kept, redacted, truncated };
}

/**
 * Builds the stored workflow item of a tool call from an untrusted one. Text fields are
 * redacted before they are capped; arguments and the raw result are kept only when debug
 * capture is on and they fit both the per-call and the remaining per-run limit. A failed
 * call gets a badge holding only a safe error code.
 */
export function sanitizeSubAgentToolItem(
  item: SubAgentWorkflowItem,
  options: { redact: SubAgentRedactor; debug: boolean; remainingRunChars: number },
): SubAgentToolCapture {
  const { redact } = options;
  const resultJson = typeof item.resultJson === "string" ? redact(item.resultJson) : undefined;
  const args = isPlainRecord(item.args) ? redactDeep(item.args, redact) : undefined;
  const payloadChars = (args ? JSON.stringify(args).length : 0) + (resultJson?.length ?? 0);
  const status = item.status === "complete" || item.status === "failed" ? item.status : "pending";
  const base: SubAgentWorkflowItem = {
    id: String(item.id),
    sessionId: String(item.sessionId),
    runId: String(item.runId),
    name: shortText(item.name, redact, MAX_LABEL_CHARS),
    label: shortText(item.label, redact, MAX_LABEL_CHARS),
    sequence: 0,
    round: Number.isSafeInteger(item.round) && item.round >= 0 ? item.round : 0,
    status,
    startedAt: String(item.startedAt),
    ...(typeof item.completedAt === "string" ? { completedAt: item.completedAt } : {}),
    ...(typeof item.resultSummary === "string"
      ? { resultSummary: shortText(item.resultSummary, redact, MAX_SUMMARY_CHARS) }
      : {}),
    ...(status === "failed" ? { badge: { text: failureCode(resultJson) } } : {}),
    payloadState: "captured",
  };
  if (payloadChars === 0) return { item: base, payloadChars: 0 };
  if (!options.debug) return { item: { ...base, payloadState: "disabled" }, payloadChars: 0 };
  if (payloadChars > MAX_TOOL_PAYLOAD_CHARS || payloadChars > options.remainingRunChars) {
    return { item: { ...base, payloadState: "truncated" }, payloadChars: 0 };
  }
  return {
    item: {
      ...base,
      ...(args ? { args } : {}),
      ...(resultJson !== undefined ? { resultJson } : {}),
    },
    payloadChars,
  };
}

function shortText(value: unknown, redact: SubAgentRedactor, max: number): string {
  return capRedactedText(redact(typeof value === "string" ? value : ""), max).text;
}

function failureCode(resultJson: string | undefined): string {
  try {
    const parsed = JSON.parse(resultJson ?? "null") as { error?: { code?: unknown } } | null;
    const code = parsed?.error?.code;
    return typeof code === "string" ? safeSubAgentCode(code) : "failed";
  } catch {
    return "failed";
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function redactDeep<T>(value: T, redact: SubAgentRedactor): T {
  if (typeof value === "string") return redact(value) as T;
  if (Array.isArray(value)) return value.map((entry: unknown) => redactDeep(entry, redact)) as T;
  if (!isPlainRecord(value)) {
    return (typeof value === "number" && !Number.isFinite(value) ? null : value) as T;
  }
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) result[key] = redactDeep(entry, redact);
  return result as T;
}

/**
 * Redacts every string of an untrusted JSON value except item ids, so a child result is
 * stored and planned only in its redacted form.
 */
export function redactSubAgentJson<T>(value: T, redact: SubAgentRedactor): T {
  if (typeof value === "string") return redact(value) as T;
  if (Array.isArray(value)) {
    return value.map((entry: unknown) => redactSubAgentJson(entry, redact)) as T;
  }
  if (!isPlainRecord(value)) return value;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = key === "id" ? entry : redactSubAgentJson(entry, redact);
  }
  return result as T;
}
