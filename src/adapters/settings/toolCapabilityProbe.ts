import { ApiFormat, ChatModelProvider, ChatRequest } from "../../core/agent/protocol";
import { ChatToolDefinition, ToolCallingCapabilities } from "../../core/agent/tool";

const PROBE_A = "ixplorer_probe_a";
const PROBE_B = "ixplorer_probe_b";
const PROBE_TOOLS: ChatToolDefinition[] = [PROBE_A, PROBE_B].map((name) => ({
  type: "function",
  function: {
    name,
    description: "Return an empty object for a local capability check.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
}));

export interface ToolCapabilityProbeOptions {
  provider: ChatModelProvider;
  model: string;
  apiFormat: ApiFormat;
  signal?: AbortSignal;
}

export interface ToolCapabilityProbeResult
  extends Pick<ToolCallingCapabilities, "calls" | "choiceRequired" | "choiceSpecific" | "parallelCalls"> {
  /** Per-mode raw tool-name arrays and timestamp for the audit trail. */
  probeAuditData: {
    ranAt: string;
    results: {
      required: string[];
      specific: string[];
      auto: string[];
    };
  };
}

export async function probeToolControlCapabilities(
  options: ToolCapabilityProbeOptions,
): Promise<ToolCapabilityProbeResult> {
  const failed: ToolCapabilityProbeResult = {
    calls: false,
    choiceRequired: false,
    choiceSpecific: false,
    parallelCalls: false,
    probeAuditData: { ranAt: new Date().toISOString(), results: { required: [], specific: [], auto: [] } },
  };
  if (options.apiFormat === "ollama") return failed;

  const ranAt = new Date().toISOString();
  const required = await runProbe(options, { type: "required" });
  const specific = await runProbe(options, { type: "specific", name: PROBE_B });
  const choiceRequired = required.some((name) => name === PROBE_A || name === PROBE_B);
  const choiceSpecific = specific.includes(PROBE_B);
  const parallelCalls = required.includes(PROBE_A) && required.includes(PROBE_B);
  const callsViaControlled = choiceRequired || choiceSpecific;
  const autoResults = callsViaControlled ? [] : await runProbe(options, { type: "auto" });
  const callsViaAuto = !callsViaControlled && autoResults.length > 0;
  return {
    calls: callsViaControlled || callsViaAuto,
    choiceRequired,
    choiceSpecific,
    parallelCalls,
    probeAuditData: {
      ranAt,
      results: { required, specific, auto: autoResults },
    },
  };
}

async function runProbe(
  options: ToolCapabilityProbeOptions,
  toolChoice: ChatRequest["toolChoice"],
): Promise<string[]> {
  try {
    const names: string[] = [];
    for await (const chunk of options.provider.streamChat({
      model: options.model,
      messages: [{ role: "user", content: "Run the requested local synthetic capability check." }],
      tools: PROBE_TOOLS,
      toolChoice,
      // Reasoning-capable local models (e.g. LM Studio harmony templates) emit a
      // chain of thought into `content` before the tool call. A tight budget
      // truncates the stream with finish_reason "length" before any call is
      // produced, making a tool-capable model look incapable. Give enough room
      // to finish reasoning and still emit the call.
      maxTokens: 512,
      temperature: 0,
      signal: options.signal,
    })) {
      for (const call of chunk.toolCalls ?? []) {
        if (Object.keys(call.arguments).length === 0) names.push(call.name);
      }
      if (chunk.isComplete) break;
    }
    return names;
  } catch {
    return [];
  }
}
