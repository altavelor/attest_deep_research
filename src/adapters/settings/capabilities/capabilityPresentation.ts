import { createToolCapabilitySettings } from "./toolCapabilities";
import { ChatModelProfile, ReasoningCapabilitySettings } from "../types";

export type CapabilityVerificationPhase =
  "testing" | "verified" | "advertised" | "not-verified" | "failed" | "not-tested";

export interface CapabilityVerificationState {
  tools: CapabilityVerificationPhase;
  agent: CapabilityVerificationPhase;
}

export function capabilityVerificationIdentity(
  profile: Pick<ChatModelProfile, "serverProfileId" | "modelName">,
): string {
  return JSON.stringify([profile.serverProfileId, profile.modelName]);
}

/**
 * Tool calling counts as supported when a probe confirmed it or when the
 * provider metadata advertises it, so a probe stays a confirmation rather
 * than the only way to unlock the capability.
 */
export function toolsVerified(profile: Pick<ChatModelProfile, "capabilities">): boolean {
  const toolCalling = profile.capabilities?.toolCalling;
  return (
    toolCalling?.probe?.calls === true ||
    toolCalling?.formatDefault.calls === true ||
    profile.capabilities?.tools === true
  );
}

export function reasoningVerified(capabilities: ReasoningCapabilitySettings | undefined): boolean {
  if (capabilities?.source === "probe") return capabilities.responses === true;
  return (
    capabilities?.source === "metadata" &&
    (capabilities.responses === true || capabilities.efforts.length > 0)
  );
}

export function resolvedAgenticModeAfterProbe(
  mode: ChatModelProfile["reasoning"]["mode"],
  capabilities: ReasoningCapabilitySettings,
): ChatModelProfile["reasoning"]["mode"] {
  return mode === "auto" && reasoningVerified(capabilities) ? "on" : mode;
}

export function deriveCapabilityVerificationState(
  profile: Pick<ChatModelProfile, "capabilities" | "reasoningCapabilities">,
): CapabilityVerificationState {
  return {
    tools: profile.capabilities?.toolCalling?.probe
      ? profile.capabilities.toolCalling.probe.calls
        ? "verified"
        : "not-verified"
      : toolsVerified(profile)
        ? "advertised"
        : "not-tested",
    agent:
      profile.reasoningCapabilities?.source === "probe"
        ? profile.reasoningCapabilities.responses
          ? "verified"
          : "not-verified"
        : reasoningVerified(profile.reasoningCapabilities)
          ? "advertised"
          : "not-tested",
  };
}

export function applyCapabilityVerificationState(
  current: CapabilityVerificationState,
  update: Partial<CapabilityVerificationState>,
): CapabilityVerificationState {
  return { ...current, ...update };
}

export function capabilityTags(profile: ChatModelProfile): Array<"Agent" | "Tools" | "Instant"> {
  const tags: Array<"Agent" | "Tools"> = [];
  if (reasoningVerified(profile.reasoningCapabilities)) tags.push("Agent");
  if (toolsVerified(profile)) tags.push("Tools");
  return tags.length > 0 ? tags : ["Instant"];
}

export function formatEffortLabel(effort: string): string {
  return effort ? `${effort.slice(0, 1).toUpperCase()}${effort.slice(1)}` : "Auto";
}

export function verificationBlockReason(verified: boolean, tested: boolean): string | undefined {
  if (verified) return undefined;
  return tested ? "Not verified by the capability test." : "Not tested yet.";
}

export function formatCapabilityVerificationStatus(state: CapabilityVerificationState): string {
  const label = (subject: string, value: CapabilityVerificationPhase) => {
    const phase: Record<CapabilityVerificationPhase, string> = {
      testing: "Testing…",
      verified: "Verified",
      advertised: "Reported by provider",
      "not-verified": "Not verified",
      failed: "Failed",
      "not-tested": "Not tested",
    };
    return `${subject}: ${phase[value]}`;
  };
  return `${label("tools support", state.tools)} · ${label("agent mode support", state.agent)}`;
}

export function mergeChatProfileSettingsPreservingProbe(
  current: ChatModelProfile,
  updated: ChatModelProfile,
): ChatModelProfile {
  const sameModel =
    current.serverProfileId === updated.serverProfileId && current.modelName === updated.modelName;
  const editableCapabilities = updated.capabilities ?? current.capabilities;
  return {
    ...updated,
    ...(editableCapabilities
      ? {
          capabilities: {
            ...editableCapabilities,
            tools: sameModel ? current.capabilities?.tools : undefined,
            toolCalling: sameModel
              ? current.capabilities?.toolCalling?.probe
                ? current.capabilities.toolCalling
                : (editableCapabilities.toolCalling ?? current.capabilities?.toolCalling)
              : createToolCapabilitySettings(false),
          },
        }
      : {}),
    reasoningCapabilities: sameModel
      ? current.reasoningCapabilities?.source === "probe"
        ? current.reasoningCapabilities
        : (updated.reasoningCapabilities ?? current.reasoningCapabilities)
      : undefined,
  };
}
