import { ModelCapabilitySnapshot, ReasoningResponseFormat } from "./modelCapabilityCache";

export interface CapabilityMetadataResolver {
  resolve(metadata: unknown): Promise<ModelCapabilitySnapshot | undefined>;
}

export async function resolveWithMetadataResolvers(
  resolvers: CapabilityMetadataResolver[],
  metadata: unknown,
): Promise<ModelCapabilitySnapshot | undefined> {
  for (const resolver of resolvers) {
    try {
      const result = await resolver.resolve(metadata);
      if (result) return result;
    } catch {}
  }
  return undefined;
}

export function resolveCapabilityMetadata(
  metadata: unknown,
  checkedAt = new Date().toISOString(),
): ModelCapabilitySnapshot | undefined {
  if (!isRecord(metadata)) return undefined;
  const endpoints = stringArray(metadata.supported_endpoints);
  const parameters = stringArray(metadata.supported_parameters);
  const formats = stringArray(metadata.reasoning_formats).flatMap((value) => {
    const format = reasoningFormat(value);
    return format ? [format] : [];
  });
  const efforts = extractReasoningEfforts(metadata);
  const defaultEffort = extractDefaultEffort(metadata);
  if (
    endpoints.length === 0 &&
    parameters.length === 0 &&
    formats.length === 0 &&
    efforts.length === 0 &&
    !defaultEffort
  )
    return undefined;
  const supportsChat = endpoints.some((endpoint) => endpoint.includes("chat/completions"));
  const supportsResponses = endpoints.some((endpoint) => endpoint.includes("responses"));
  const supportsReasoningControl = parameters.some((parameter) =>
    ["reasoning", "reasoning_effort", "reasoning.effort"].includes(parameter),
  );
  return {
    protocols: {
      chatCompletions: supportsChat ? "supported" : "unknown",
      responses: supportsResponses ? "supported" : "unknown",
    },
    reasoning: {
      responseFormats: [...new Set(formats)],
      ...(supportsResponses && supportsReasoningControl ? { requestDialect: "responses" } : {}),
      visibleOutput: formats.length > 0 ? "supported" : "unknown",
      ...(efforts.length > 0 ? { efforts } : {}),
      ...(defaultEffort ? { defaultEffort } : {}),
    },
    tools: parameters.includes("tools") ? "supported" : "unknown",
    continuation: supportsResponses ? "supported" : "unknown",
    summary: parameters.some((parameter) => parameter.includes("summary"))
      ? "supported"
      : "unknown",
    source: "metadata",
    checkedAt,
    contractVersion: 1,
  };
}

/** Returns the first advertised non-empty effort list, preserving provider order. */
export function extractReasoningEfforts(metadata: unknown): string[] {
  if (!isRecord(metadata)) return [];
  const reasoning = isRecord(metadata.reasoning) ? metadata.reasoning : undefined;
  const parameters = isRecord(metadata.parameters) ? metadata.parameters : undefined;
  const reasoningParameter =
    parameters && isRecord(parameters.reasoning_effort) ? parameters.reasoning_effort : undefined;
  const capabilities = isRecord(metadata.capabilities) ? metadata.capabilities : undefined;
  const capabilityReasoning =
    capabilities && isRecord(capabilities.reasoning) ? capabilities.reasoning : undefined;
  for (const candidate of [
    metadata.supported_reasoning_efforts,
    reasoning?.efforts,
    reasoningParameter?.enum,
    capabilityReasoning?.efforts,
  ]) {
    const efforts = uniqueStrings(candidate);
    if (efforts.length > 0) return efforts;
  }
  return [];
}

function extractDefaultEffort(metadata: Record<string, unknown>): string | undefined {
  const reasoning = isRecord(metadata.reasoning) ? metadata.reasoning : undefined;
  const capabilities = isRecord(metadata.capabilities) ? metadata.capabilities : undefined;
  const capabilityReasoning =
    capabilities && isRecord(capabilities.reasoning) ? capabilities.reasoning : undefined;
  for (const candidate of [
    metadata.default_reasoning_effort,
    reasoning?.defaultEffort,
    reasoning?.default_effort,
    capabilityReasoning?.defaultEffort,
    capabilityReasoning?.default_effort,
  ]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

function reasoningFormat(value: string): ReasoningResponseFormat | undefined {
  return [
    "reasoning_details",
    "reasoning",
    "reasoning_content",
    "thinking",
    "inline_tags",
    "responses_text",
    "responses_summary",
  ].includes(value)
    ? (value as ReasoningResponseFormat)
    : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function uniqueStrings(value: unknown): string[] {
  return [
    ...new Set(
      stringArray(value)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
