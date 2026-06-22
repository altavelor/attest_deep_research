import {
  ApiFormat,
  ChatModelProvider,
  ChatRequest,
  ChatToolDefinition,
  ToolCallingCapabilities,
} from "../shared/types";

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

export async function probeToolControlCapabilities(
  options: ToolCapabilityProbeOptions,
): Promise<
  Pick<ToolCallingCapabilities, "calls" | "choiceRequired" | "choiceSpecific" | "parallelCalls">
> {
  const failed = {
    calls: false,
    choiceRequired: false,
    choiceSpecific: false,
    parallelCalls: false,
  };
  if (options.apiFormat === "ollama") return failed;

  const required = await runProbe(options, { type: "required" });
  const specific = await runProbe(options, { type: "specific", name: PROBE_B });
  const choiceRequired = required.some((name) => name === PROBE_A || name === PROBE_B);
  const choiceSpecific = specific.includes(PROBE_B);
  const parallelCalls = required.includes(PROBE_A) && required.includes(PROBE_B);
  const callsViaControlled = choiceRequired || choiceSpecific;
  const callsViaAuto = callsViaControlled
    ? false
    : (await runProbe(options, { type: "auto" })).length > 0;
  return {
    calls: callsViaControlled || callsViaAuto,
    choiceRequired,
    choiceSpecific,
    parallelCalls,
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
      maxTokens: 32,
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
