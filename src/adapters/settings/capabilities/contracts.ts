import { ChatApiProtocol, ToolCallingCapabilities } from "@core/agent";
import { ToolCapabilityProbeAudit } from "@core/diagnostics";

export type ToolCapabilitySource = "format-default" | "probe";
export type ToolCapabilityLayer = Partial<ToolCallingCapabilities>;

export interface ToolCapabilitySettings {
  formatDefault: ToolCallingCapabilities;
  advertised?: ToolCapabilityLayer;
  probe?: ToolCapabilityLayer;

  probeAudit?: ToolCapabilityProbeAudit;
}

export interface EffectiveToolCapabilities {
  capabilities: ToolCallingCapabilities;
  provenance: Record<keyof ToolCallingCapabilities, ToolCapabilitySource>;
}

export type CapabilityState = "supported" | "unsupported" | "unknown";

export interface ToolControlSupport {
  choiceRequired: boolean;
  choiceSpecific: boolean;
  parallelCalls: boolean;
}

export type ReasoningResponseFormat =
  | "reasoning_details"
  | "reasoning"
  | "reasoning_content"
  | "thinking"
  | "inline_tags"
  | "responses_text"
  | "responses_summary";

export interface ModelCapabilitySnapshot {
  protocols: {
    chatCompletions: CapabilityState;
    responses: CapabilityState;
  };
  reasoning: {
    responseFormats: ReasoningResponseFormat[];
    requestDialect?: "responses" | "openrouter" | "provider-extension";
    efforts?: string[];
    defaultEffort?: string;
    visibleOutput: CapabilityState;
  };
  tools: CapabilityState;
  toolControls?: ToolControlSupport;
  continuation: CapabilityState;
  summary: CapabilityState;
  source: "metadata" | "observed" | "manual" | "probe";
  checkedAt: string;
  expiresAt?: string;
  contractVersion: 1;
}

export interface CapabilityIdentity {
  baseUrl: string;
  apiKey?: string;
  model: string;
  protocol: ChatApiProtocol;
}
