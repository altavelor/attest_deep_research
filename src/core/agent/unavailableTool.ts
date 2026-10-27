import { SUB_AGENT_TOOLS } from "./toolNames";

export const TOOL_UNAVAILABLE_CODE = "tool-unavailable";

export type UnavailableToolReason = "instant" | "no-tools" | "not-permitted" | "not-offered";

export interface UnavailableToolContext {
  reason: UnavailableToolReason;
  available?: readonly string[];
}

export interface UnavailableToolDescription {
  code: typeof TOOL_UNAVAILABLE_CODE;
  userMessageKey: string;
  params: { tool: string };
  modelMessage: string;
}

const REASON_TEXT: Record<UnavailableToolReason, string> = {
  instant: "Instant mode offers no tools",
  "no-tools": "no tools are offered for this answer",
  "not-permitted": "it is disabled by the current settings or permissions",
  "not-offered": "it is not offered in this run",
};

/**
 * Describes a call to a tool the run cannot execute: a stable failure code, a
 * localizable user message key with its parameters, and a message telling the
 * model why and which tools it may call instead.
 */
export function describeUnavailableTool(
  name: string,
  context: UnavailableToolContext,
): UnavailableToolDescription {
  const available = context.available ?? [];
  const toolsLine =
    available.length > 0
      ? `Available tools: ${available.join(", ")}.`
      : "No tools are available; answer in plain text.";
  return {
    code: TOOL_UNAVAILABLE_CODE,
    userMessageKey: userMessageKey(name, context.reason),
    params: { tool: name },
    modelMessage: `Tool "${name}" is not available: ${REASON_TEXT[context.reason]}. ${toolsLine}`,
  };
}

function userMessageKey(name: string, reason: UnavailableToolReason): string {
  const toolless = reason === "instant" || reason === "no-tools";
  if (toolless && (SUB_AGENT_TOOLS as readonly string[]).includes(name)) {
    return "chat.toolUnavailable.subAgents";
  }
  return `chat.toolUnavailable.${reason}`;
}
