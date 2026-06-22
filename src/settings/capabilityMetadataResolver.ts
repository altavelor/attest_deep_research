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
    } catch {
      // Optional metadata cannot disable generic compatible operation.
    }
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
  if (endpoints.length === 0 && parameters.length === 0 && formats.length === 0) return undefined;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
