import { ToolCallingCapabilities } from "@core/agent";
import {
  EffectiveToolCapabilities,
  ToolCapabilityLayer,
  ToolCapabilitySettings,
  ToolControlSupport,
} from "./contracts";
import type { ToolCapabilityProbeAudit } from "@core/diagnostics";

export type {
  EffectiveToolCapabilities,
  ToolCapabilityLayer,
  ToolCapabilitySettings,
  ToolCapabilitySource,
} from "./contracts";

const FLAGS: readonly (keyof ToolCallingCapabilities)[] = [
  "calls",
  "choiceRequired",
  "choiceSpecific",
  "parallelCalls",
];

export function createToolCapabilitySettings(calls = false): ToolCapabilitySettings {
  return {
    formatDefault: { calls, choiceRequired: false, choiceSpecific: false, parallelCalls: false },
  };
}

/**
 * Turns what the provider advertises for a model into tool-capability settings.
 * The wizard and the model profile screen both create profiles from a
 * discovered model, so they must read the same answer out of it.
 */
export function advertisedToolCapabilities(model: {
  capabilities: { tools?: boolean };
  capabilitySnapshot?: { tools?: string; toolControls?: ToolControlSupport };
}): ToolCapabilitySettings {
  const calls =
    model.capabilitySnapshot?.tools === "supported" || model.capabilities.tools === true;
  const controls = model.capabilitySnapshot?.toolControls;
  const advertised = {
    calls,
    choiceRequired: calls && controls?.choiceRequired === true,
    choiceSpecific: calls && controls?.choiceSpecific === true,
    parallelCalls: calls && controls?.parallelCalls === true,
  };
  return { formatDefault: advertised, advertised };
}

export function resolveToolCapabilities(
  settings?: ToolCapabilitySettings,
): EffectiveToolCapabilities {
  const normalized = settings ?? createToolCapabilitySettings(false);
  const capabilities = {} as ToolCallingCapabilities;
  const provenance = {} as EffectiveToolCapabilities["provenance"];
  for (const flag of FLAGS) {
    if (typeof normalized.probe?.[flag] === "boolean") {
      capabilities[flag] = normalized.probe[flag]!;
      provenance[flag] = "probe";
    } else {
      capabilities[flag] = normalized.formatDefault[flag];
      provenance[flag] = "format-default";
    }
  }
  return { capabilities, provenance };
}

export function withProbeResults(
  settings: ToolCapabilitySettings,
  probe: ToolCapabilityLayer,
  probeAudit?: ToolCapabilityProbeAudit,
): ToolCapabilitySettings {
  return {
    formatDefault: { ...settings.formatDefault },
    ...(settings.advertised ? { advertised: { ...settings.advertised } } : {}),
    probe: { ...(settings.probe ?? {}), ...probe },
    ...(probeAudit ? { probeAudit } : {}),
  };
}

export function canProbeToolCapabilities<TServer, TProbe>(input: {
  server?: TServer;
  modelName: string;
  probe?: TProbe;
}): input is { server: TServer; modelName: string; probe: TProbe } {
  return (
    input.server !== undefined && input.modelName.trim().length > 0 && input.probe !== undefined
  );
}

export function describeToolCapability(
  settings: ToolCapabilitySettings,
  flag: keyof ToolCallingCapabilities,
): string {
  const effective = resolveToolCapabilities(settings);
  return `Needed by thinking research. Current: ${effective.capabilities[flag] ? "enabled" : "disabled"} (${effective.provenance[flag]}).`;
}
