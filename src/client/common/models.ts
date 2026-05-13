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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
