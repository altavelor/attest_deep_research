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
  /**
   * Whether the model can force a specific tool by name (`tool_choice` naming a
   * single function). When false, callers that need to compel a particular tool
   * (e.g. repairing a missing mandatory call) must fall back to `required`.
   */
  supportsSpecificChoice: boolean;
}

export function resolveResearchExecutionPolicy(
  input: ResearchExecutionPolicyInput,
): Readonly<ResearchExecutionPolicy> {
  // The model chooses tools itself (`auto`); this policy only chooses the
  // top-level research execution path.
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
  // The only capability that still matters is whether the model can call tools at
  // all. Specific/required/parallel choice no longer gate eligibility because we
  // never force a tool.
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
