import { ToolCallingCapabilities } from "../shared/types";

export type ToolCapabilitySource = "format-default" | "probe" | "manual";
export type ToolCapabilityLayer = Partial<ToolCallingCapabilities>;

export interface ToolCapabilitySettings {
  formatDefault: ToolCallingCapabilities;
  probe?: ToolCapabilityLayer;
  manual?: ToolCapabilityLayer;
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
    if (typeof normalized.manual?.[flag] === "boolean") {
      capabilities[flag] = normalized.manual[flag]!;
      provenance[flag] = "manual";
    } else if (typeof normalized.probe?.[flag] === "boolean") {
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
): ToolCapabilitySettings {
  return {
    formatDefault: { ...settings.formatDefault },
    probe: { ...(settings.probe ?? {}), ...probe },
    ...(settings.manual ? { manual: { ...settings.manual } } : {}),
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
  return `Needed by agentic research. Current: ${effective.capabilities[flag] ? "enabled" : "disabled"} (${effective.provenance[flag]}).`;
}

export function normalizeToolCapabilitySettings(
  value: unknown,
  legacyTools: boolean | undefined,
  legacySource: string,
): ToolCapabilitySettings {
  const record = isRecord(value) ? value : undefined;
  const formatDefault =
    (readLayer(record?.formatDefault, true) as ToolCallingCapabilities | undefined) ??
    createToolCapabilitySettings(false).formatDefault;
  const probe = readLayer(record?.probe);
  const manual = readLayer(record?.manual);
  if (record) {
    return { formatDefault, ...(probe ? { probe } : {}), ...(manual ? { manual } : {}) };
  }
  const migrated = createToolCapabilitySettings(false);
  if (typeof legacyTools === "boolean") {
    const layer = { calls: legacyTools };
    if (legacySource === "probe" || legacySource === "metadata") migrated.probe = layer;
    else migrated.manual = layer;
  }
  return migrated;
}

function readLayer(value: unknown, complete = false): ToolCapabilityLayer | undefined {
  if (!isRecord(value)) return undefined;
  const layer: ToolCapabilityLayer = {};
  for (const flag of FLAGS) {
    if (typeof value[flag] === "boolean") layer[flag] = value[flag] as never;
    else if (complete) layer[flag] = false as never;
  }
  return Object.keys(layer).length > 0 ? layer : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
