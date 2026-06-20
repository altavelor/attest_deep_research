import {
  ChatToolChoice,
  ApiFormat,
  ResearchExecutionStrategy,
  ToolCallingCapabilities,
} from "../shared/types";
import { ResearchSearchMode } from "./types";

export type ResearchPolicyReason =
  | "forced-eager"
  | "deep-research-eager"
  | "eligible"
  | "tool-calls-unavailable"
  | "specific-choice-unavailable"
  | "required-choice-unavailable"
  | "parallel-calls-unavailable"
  | "retriever-unavailable"
  | "web-provider-unavailable"
  | "active-file-unavailable"
  | "provider-tool-control-unsupported";

export interface ResearchExecutionPolicyInput {
  forceEagerResearch: boolean;
  deepResearch: boolean;
  searchMode: ResearchSearchMode;
  includeActiveFile: boolean;
  dependencies: {
    retriever: boolean;
    webProvider: boolean;
    activeFileAccess: boolean;
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
}

export function resolveResearchExecutionPolicy(
  input: ResearchExecutionPolicyInput,
): Readonly<ResearchExecutionPolicy> {
  const requiredTools = mandatoryTools(input.searchMode, input.includeActiveFile);
  const bootstrapChoice = choiceFor(requiredTools);
  const base = { requiredTools, bootstrapChoice, parallelToolCalls: requiredTools.length > 1 };

  if (input.forceEagerResearch) {
    return freeze({ ...base, strategy: "eager-forced", reason: "forced-eager" });
  }
  if (input.deepResearch) {
    return freeze({ ...base, strategy: "eager-default", reason: "deep-research-eager" });
  }
  if (input.apiFormat === "ollama") {
    return freeze({
      ...base,
      strategy: "deterministic-fallback",
      reason: "provider-tool-control-unsupported",
    });
  }

  const unavailable =
    dependencyFailure(input, requiredTools) ?? capabilityFailure(input, requiredTools);
  if (unavailable) {
    return freeze({ ...base, strategy: "deterministic-fallback", reason: unavailable });
  }
  return freeze({ ...base, strategy: "agentic", reason: "eligible" });
}

function mandatoryTools(
  searchMode: ResearchSearchMode,
  includeActiveFile: boolean,
): readonly string[] {
  const tools: string[] = [];
  if (searchMode === "indexOnly" || searchMode === "indexAndWeb") tools.push("search_index");
  if (searchMode === "webOnly" || searchMode === "indexAndWeb") tools.push("search_web");
  if (includeActiveFile) tools.push("get_active_note");
  return Object.freeze(tools);
}

function choiceFor(requiredTools: readonly string[]): ChatToolChoice {
  if (requiredTools.length === 0) return Object.freeze({ type: "auto" });
  if (requiredTools.length === 1) {
    return Object.freeze({ type: "specific", name: requiredTools[0] });
  }
  return Object.freeze({ type: "required" });
}

function dependencyFailure(
  input: ResearchExecutionPolicyInput,
  requiredTools: readonly string[],
): ResearchPolicyReason | undefined {
  if (requiredTools.includes("search_index") && !input.dependencies.retriever) {
    return "retriever-unavailable";
  }
  if (requiredTools.includes("search_web") && !input.dependencies.webProvider) {
    return "web-provider-unavailable";
  }
  if (requiredTools.includes("get_active_note") && !input.dependencies.activeFileAccess) {
    return "active-file-unavailable";
  }
  return undefined;
}

function capabilityFailure(
  input: ResearchExecutionPolicyInput,
  requiredTools: readonly string[],
): ResearchPolicyReason | undefined {
  const capabilities = input.capabilities;
  if (!capabilities.calls) return "tool-calls-unavailable";
  if (requiredTools.length === 1 && !capabilities.choiceSpecific) {
    return "specific-choice-unavailable";
  }
  if (requiredTools.length > 1 && !capabilities.choiceRequired) {
    return "required-choice-unavailable";
  }
  if (requiredTools.length > 1 && !capabilities.parallelCalls) {
    return "parallel-calls-unavailable";
  }
  return undefined;
}

function freeze(policy: ResearchExecutionPolicy): Readonly<ResearchExecutionPolicy> {
  return Object.freeze(policy);
}
