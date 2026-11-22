import type { ResearchStreamEvent } from "@application/contracts/research";
import { toolCallChainLabel } from "@application/research";
import type { ResearchAnswer } from "@core/answer";
import { redactSubAgentJson, type SubAgentRedactor } from "@core/research";

/**
 * Redacts credentials from the tool call arguments a research event carries before the
 * parent's history keeps them: a call's label is rebuilt from its redacted arguments and
 * the tool entries of the final answer's diagnostics are redacted too.
 */
export function redactToolEvent(
  event: ResearchStreamEvent,
  redact: SubAgentRedactor | undefined,
): ResearchStreamEvent {
  if (!redact) return event;
  if (event.type === "tool-call-start" && event.args) {
    const args = redactSubAgentJson(event.args, redact);
    if (JSON.stringify(args) === JSON.stringify(event.args)) return event;
    return { ...event, args, label: toolCallChainLabel(event.name, args) };
  }
  if (event.type === "complete" && event.answer.contextDiagnostics) {
    return { ...event, answer: redactAnswerTools(event.answer, redact) };
  }
  return event;
}

function redactAnswerTools(answer: ResearchAnswer, redact: SubAgentRedactor): ResearchAnswer {
  const diagnostics = answer.contextDiagnostics!;
  return {
    ...answer,
    contextDiagnostics: { ...diagnostics, tools: redactSubAgentJson(diagnostics.tools, redact) },
  };
}
