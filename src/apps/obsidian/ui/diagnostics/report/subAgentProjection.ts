import { SUB_AGENT_RESULTS_PREAMBLE } from "@application/research";
import { isSubAgentTool } from "@core/conversation";
import type { ContextDiagnostics, RoundPromptDeltaDiagnostic } from "@core/diagnostics";

export const WITHHELD_SUB_AGENT_OUTPUT = "[withheld sub-agent output]";

/**
 * Projects saved diagnostics, including ones written before child output was withheld,
 * for every report view: sub-agent tool previews and delivered child results in prompt
 * deltas keep only their sizes.
 */
export function withholdSubAgentDiagnostics(diagnostics: ContextDiagnostics): ContextDiagnostics {
  const tools = (diagnostics.tools ?? []).map((call) =>
    isSubAgentTool(call.name) && call.resultPreview !== undefined
      ? { ...call, resultPreview: WITHHELD_SUB_AGENT_OUTPUT }
      : call,
  );
  const thinking = diagnostics.thinking;
  return {
    ...diagnostics,
    tools,
    ...(thinking?.promptDeltas
      ? { thinking: { ...thinking, promptDeltas: thinking.promptDeltas.map(withoutDeliveries) } }
      : {}),
  };
}

function withoutDeliveries(delta: RoundPromptDeltaDiagnostic): RoundPromptDeltaDiagnostic {
  return {
    ...delta,
    messages: delta.messages.map((message) => {
      if (!message.content?.startsWith(SUB_AGENT_RESULTS_PREAMBLE)) return message;
      const { content: _content, truncatedChars: _truncated, ...rest } = message;
      return rest;
    }),
  };
}
