import { ApiFormat, ChatModelProvider, ChatRequest } from "@core/agent";
import { ChatToolDefinition, ToolCallingCapabilities } from "@core/agent";

const PROBE_A = "attest_probe_a";
const PROBE_B = "attest_probe_b";
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

export interface ToolCapabilityProbeResult extends Pick<
  ToolCallingCapabilities,
  "calls" | "choiceRequired" | "choiceSpecific" | "parallelCalls"
> {
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
    probeAuditData: {
      ranAt: new Date().toISOString(),
      results: { required: [], specific: [], auto: [] },
    },
  };
  if (options.apiFormat === "ollama") return failed;

  const ranAt = new Date().toISOString();
  throwIfAborted(options.signal);
  const required = await runProbe(options, { type: "required" });
  throwIfAborted(options.signal);
  const specific = await runProbe(options, { type: "specific", name: PROBE_B });
  throwIfAborted(options.signal);
  const choiceRequired = required.some((name) => name === PROBE_A || name === PROBE_B);
  const choiceSpecific = specific.includes(PROBE_B);
  const parallelCalls = required.includes(PROBE_A) && required.includes(PROBE_B);
  const callsViaControlled = choiceRequired || choiceSpecific;
  const autoResults = callsViaControlled ? [] : await runProbe(options, { type: "auto" });
  throwIfAborted(options.signal);
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
  } catch (error) {
    if (isCancellation(error) || options.signal?.aborted === true) {
      throw error;
    }
    return [];
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new DOMException("Tool capability probe cancelled.", "AbortError");
  }
}

function isCancellation(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
