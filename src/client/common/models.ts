import { isRecord } from "../../shared/guards";

export interface OpenAiModelsResponse {
  data: Array<{ id: string }>;
}

export interface OllamaTagsResponse {
  models: Array<{ name?: string; model?: string }>;
}

export function isOpenAiModelsResponse(value: unknown): value is OpenAiModelsResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.data) &&
    value.data.every((item) => isRecord(item) && typeof item.id === "string")
  );
}

export function isOllamaTagsResponse(value: unknown): value is OllamaTagsResponse {
  return (
    isRecord(value) && Array.isArray(value.models) && value.models.every((model) => isRecord(model))
  );
}

export function modelNamesFromOpenAiModels(response: OpenAiModelsResponse): string[] {
  return response.data.map((model) => model.id);
}

export function modelNamesFromOllamaTags(response: OllamaTagsResponse): string[] {
  return response.models
    .map((model) => model.name ?? model.model)
    .filter((model): model is string => typeof model === "string" && model.length > 0);
}

export function contextLengthFromModelMetadata(value: unknown): number | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const directValue = firstPositiveInteger(
    value.max_context_length,
    value.context_length,
    value.context_window,
    value.maxContextLength,
    value.contextLength,
  );
  if (directValue !== undefined) {
    return directValue;
  }

  const nestedValue = contextLengthFromModelMetadata(value.capabilities);
  if (nestedValue !== undefined) {
    return nestedValue;
  }

  if (!isRecord(value.model_info)) {
    return undefined;
  }

  return firstPositiveInteger(
    ...Object.entries(value.model_info)
      .filter(([key]) => key.endsWith(".context_length"))
      .map(([, metadataValue]) => metadataValue),
  );
}

function firstPositiveInteger(...values: unknown[]): number | undefined {
  return values.find(
    (value): value is number => typeof value === "number" && Number.isInteger(value) && value > 0,
  );
}
