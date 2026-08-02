import { ChatToolChoice, ToolCallingCapabilities } from "@core/agent/tool";
import { ApiFormat } from "@core/agent/protocol";
import { ResearchExecutionStrategy } from "@core/diagnostics";
import { ResearchMode } from "./researchMode";

export type ResearchPolicyReason =
  | "instant-selected"
  | "thinking-eligible"
  | "deep-research-selected"
  | "tool-calls-unavailable"
  | "provider-tool-control-unsupported";

export interface ResearchExecutionPolicyInput {
  mode: ResearchMode;
  capabilities: ToolCallingCapabilities;
  apiFormat?: ApiFormat;
}

export interface ResearchExecutionPolicy {
  strategy: ResearchExecutionStrategy;
  reason: ResearchPolicyReason;
  requiredTools: readonly string[];
  bootstrapChoice: ChatToolChoice;
  parallelToolCalls: boolean;

  supportsSpecificChoice: boolean;
}

export function resolveResearchExecutionPolicy(
  input: ResearchExecutionPolicyInput,
): Readonly<ResearchExecutionPolicy> {
  const base = {
    requiredTools: Object.freeze([] as string[]),
    bootstrapChoice: Object.freeze({ type: "auto" as const }),
    parallelToolCalls: input.capabilities.parallelCalls,
    supportsSpecificChoice: input.capabilities.choiceSpecific,
  };

  if (input.mode === "instant") {
    return freeze({ ...base, strategy: "instant", reason: "instant-selected" });
  }
  if (input.mode === "deep-research") {
    return freeze({ ...base, strategy: "deep-research", reason: "deep-research-selected" });
  }
  if (input.apiFormat === "ollama") {
    return freeze({
      ...base,
      strategy: "instant-fallback",
      reason: "provider-tool-control-unsupported",
    });
  }
  if (!input.capabilities.calls) {
    return freeze({
      ...base,
      strategy: "instant-fallback",
      reason: "tool-calls-unavailable",
    });
  }
  return freeze({ ...base, strategy: "thinking", reason: "thinking-eligible" });
}

function freeze(policy: ResearchExecutionPolicy): Readonly<ResearchExecutionPolicy> {
  return Object.freeze(policy);
}
