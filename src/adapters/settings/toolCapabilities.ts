import { ToolCallingCapabilities } from "@core/agent";
import { ToolCapabilityProbeAudit } from "@core/diagnostics";

export type ToolCapabilitySource = "format-default" | "probe";
export type ToolCapabilityLayer = Partial<ToolCallingCapabilities>;

export interface ToolCapabilitySettings {
  formatDefault: ToolCallingCapabilities;
  probe?: ToolCapabilityLayer;

  probeAudit?: ToolCapabilityProbeAudit;
}

export interface EffectiveToolCapabilities {
  capabilities: ToolCallingCapabilities;
  provenance: Record<keyof ToolCallingCapabilities, ToolCapabilitySource>;
}

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
