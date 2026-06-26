import { ChatToolChoice, ToolCallingCapabilities } from "../agent/tool";
import { ApiFormat } from "../agent/protocol";
import { ResearchExecutionStrategy } from "../diagnostics";
import { ResearchSearchMode } from "./searchMode";

export type ResearchPolicyReason =
  | "forced-eager"
  | "eligible"
  | "tool-calls-unavailable"
  | "specific-choice-unavailable"
  | "required-choice-unavailable"
  | "parallel-calls-unavailable"
  | "retriever-unavailable"
  | "web-provider-unavailable"
  | "provider-tool-control-unsupported";

export interface ResearchExecutionPolicyInput {
  forceEagerResearch: boolean;
  searchMode: ResearchSearchMode;
  dependencies: {
    retriever: boolean;
    webProvider: boolean;
  };
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
  // Codex-style: the model chooses tools itself (`auto`). The search mode is only
  // a tool-availability filter (applied in the tool registry), never a mandate.
  // Grounding against fabrication is handled behaviorally by the citation guard,
  // not by forcing a specific tool here.
  const base = {
    requiredTools: Object.freeze([] as string[]),
    bootstrapChoice: Object.freeze({ type: "auto" as const }),
    parallelToolCalls: input.capabilities.parallelCalls,
    supportsSpecificChoice: input.capabilities.choiceSpecific,
  };

  if (input.forceEagerResearch) {
    return freeze({ ...base, strategy: "eager-forced", reason: "forced-eager" });
  }
  if (input.apiFormat === "ollama") {
    return freeze({
      ...base,
      strategy: "deterministic-fallback",
      reason: "provider-tool-control-unsupported",
    });
  }
  // The only capability that still matters is whether the model can call tools at
  // all. Specific/required/parallel choice no longer gate eligibility because we
  // never force a tool.
  if (!input.capabilities.calls) {
    return freeze({ ...base, strategy: "deterministic-fallback", reason: "tool-calls-unavailable" });
  }
  return freeze({ ...base, strategy: "agentic", reason: "eligible" });
}

function freeze(policy: ResearchExecutionPolicy): Readonly<ResearchExecutionPolicy> {
  return Object.freeze(policy);
}
