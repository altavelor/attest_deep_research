export type SubAgentInputValidation<T> =
  { ok: true; value: T } | { ok: false; code: string; message: string };

export type SubAgentTaskOrigin = "direct" | "map_sources";

export const MAX_SUB_AGENT_TASK_CHARS = 2_000;
const MAX_MAP_SOURCES_TASK_CHARS = 8_192;

export const MAX_SUB_AGENT_RESOURCES = 8;
export const MAX_SUB_AGENT_RESOURCE_CHARS = 120;

export const MIN_SUB_AGENT_SEARCHES = 1;
export const MAX_SUB_AGENT_SEARCHES = 20;
export const DEFAULT_SUB_AGENT_SEARCHES = 8;

/**
 * Trims a sub-agent task and enforces its length limit. Only the trusted map_sources
 * origin, supplied by the host and never by the model, may use the larger compiled-task limit.
 */
export function validateSubAgentTaskInput(
  value: unknown,
  origin: SubAgentTaskOrigin = "direct",
): SubAgentInputValidation<string> {
  const task = typeof value === "string" ? value.trim() : "";
  if (!task) {
    return { ok: false, code: "missing-task", message: "A task instruction is required." };
  }
  const limit = origin === "map_sources" ? MAX_MAP_SOURCES_TASK_CHARS : MAX_SUB_AGENT_TASK_CHARS;
  if (task.length > limit) {
    return {
      ok: false,
      code: "task-too-long",
      message: `Task must not exceed ${limit} characters.`,
    };
  }
  return { ok: true, value: task };
}

/**
 * Reads the optional search budget, defaulting to 8 and clamping finite integers to 1-20.
 * Fractions and non-finite or non-numeric values are rejected.
 */
export function readSubAgentSearchBudget(value: unknown): SubAgentInputValidation<number> {
  if (value === undefined) return { ok: true, value: DEFAULT_SUB_AGENT_SEARCHES };
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return { ok: false, code: "invalid-max-searches", message: "maxSearches must be an integer." };
  }
  return {
    ok: true,
    value: Math.max(MIN_SUB_AGENT_SEARCHES, Math.min(MAX_SUB_AGENT_SEARCHES, value)),
  };
}

/** Accepts at most eight trimmed, non-empty resource strings of up to 120 characters each. */
export function validateSubAgentResources(value: unknown): SubAgentInputValidation<string[]> {
  if (value === undefined) return { ok: true, value: [] };
  const entries = Array.isArray(value)
    ? value.map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    : [];
  if (
    !Array.isArray(value) ||
    entries.length > MAX_SUB_AGENT_RESOURCES ||
    entries.some((entry) => entry.length === 0 || entry.length > MAX_SUB_AGENT_RESOURCE_CHARS)
  ) {
    return {
      ok: false,
      code: "invalid-resources",
      message: `resources must be an array of at most ${MAX_SUB_AGENT_RESOURCES} non-empty strings.`,
    };
  }
  return { ok: true, value: entries };
}
