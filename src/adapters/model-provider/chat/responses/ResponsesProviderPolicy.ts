// Pure policy for whether the Responses protocol may be used for a model profile
// (stage 1, task 6.2). Extracted from main.ts so the branching/validation can be
// unit-tested without constructing a plugin. Returns the verified reasoning
// settings to build the client with, or throws IxplorerError describing why not.

import { ApiFormat } from "@core/agent";
import { IxplorerError } from "../../../../core/errors";
import { ReasoningCapabilitySettings } from "../../../settings/types";

export interface ResponsesPolicyInput {
  apiFormat: ApiFormat;
  capabilities?: ReasoningCapabilitySettings;
  /** Result of the staleness probe (caller computes; keeps this function pure). */
  isCapabilityCurrent: boolean;
  reasoning: { enabled: boolean; effort?: string; summary: "off" | "auto" };
}

export interface ResponsesPolicyDecision {
  efforts: string[];
  summary: boolean;
}

function unsupported(message: string): never {
  throw new IxplorerError({ code: "UNSUPPORTED_CAPABILITY", message });
}

export function resolveResponsesProviderPolicy(
  input: ResponsesPolicyInput,
): ResponsesPolicyDecision {
  const { apiFormat, capabilities, isCapabilityCurrent, reasoning } = input;

  if (apiFormat !== "openai-compatible") {
    unsupported("The Responses protocol requires an OpenAI-compatible server profile.");
  }
  if (!capabilities) {
    unsupported("Responses capability detection has not completed for this model profile.");
  }
  if (!capabilities.responses) {
    unsupported(
      capabilities.failureReason ??
        "The capability probe reported that this model does not support Responses.",
    );
  }
  if (!isCapabilityCurrent) {
    unsupported("The Responses capability probe is stale for this model profile.");
  }
  if (reasoning.enabled) {
    if (capabilities.continuation !== true) {
      unsupported("Reasoning continuation has not been verified for this model profile.");
    }
    if (capabilities.requiresEffort && !reasoning.effort) {
      unsupported("This model requires an explicit reasoning effort.");
    }
    if (reasoning.effort && !capabilities.efforts.includes(reasoning.effort)) {
      unsupported("The selected reasoning effort is not supported by this model profile.");
    }
    if (reasoning.summary === "auto" && !capabilities.summary) {
      unsupported("Reasoning summaries are not supported by this model profile.");
    }
  }

  return { efforts: capabilities.efforts, summary: capabilities.summary };
}
