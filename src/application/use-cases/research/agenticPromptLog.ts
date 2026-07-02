import { ChatMessage, ChatRequest, ModelToolOutput } from "@core/agent";
import { PromptDeltaMessageDiagnostic, RoundPromptDeltaDiagnostic } from "@core/diagnostics";

// Cap per logged message so a huge initial context doesn't balloon the report;
// the cut is reported via `truncatedChars` so nothing disappears silently.
const MESSAGE_CONTENT_CAP = 6_000;

/**
 * Builds the incremental prompt-delta record for one agentic round: the messages
 * appended to the transcript since the previous round's request (round 1 sees the
 * full initial prompt) plus, in provider-continuation mode, the tool outputs that
 * travel outside `messages`.
 */
export function buildRoundPromptDelta(
  round: number,
  toolChoice: ChatRequest["toolChoice"],
  appendedMessages: ChatMessage[],
  toolOutputs?: ModelToolOutput[],
): RoundPromptDeltaDiagnostic {
  const messages = appendedMessages.map(promptDeltaMessage);
  for (const output of toolOutputs ?? []) {
    messages.push({ role: "tool", chars: output.output.length, toolCallId: output.callId });
  }
  return {
    round,
    toolChoice: JSON.stringify(toolChoice ?? null),
    ...(toolOutputs ? { viaContinuation: true } : {}),
    messages,
  };
}

function promptDeltaMessage(message: ChatMessage): PromptDeltaMessageDiagnostic {
  const content = message.content ?? "";
  const base: PromptDeltaMessageDiagnostic = { role: message.role, chars: content.length };
  if (message.role === "tool") {
    // Content already lives in the round's ToolCallDiagnostic (redacted where needed).
    return { ...base, ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}) };
  }
  if (message.toolCalls && message.toolCalls.length > 0) {
    base.toolCallNames = message.toolCalls.map((call) => call.name);
  }
  base.content = content.slice(0, MESSAGE_CONTENT_CAP);
  if (content.length > MESSAGE_CONTENT_CAP) {
    base.truncatedChars = content.length - MESSAGE_CONTENT_CAP;
  }
  return base;
}
