// Публичный API модуля adapters/model-provider — клиенты чата и эмбеддингов,
// round-адаптеры, политика Responses-провайдера и helpers метаданных моделей.
// Внутренняя реализация (SDK-провайдеры, streaming-парсеры, common/http|streams)
// наружу не выставляется; её white-box юнит-тесты подключают напрямую.
//
// Инвариант: файлы ВНУТРИ модуля не импортируют этот баррель — только соседей
// через `./…`, иначе цикл (ловит `npm run depcruise`).

export { ChatModelClient } from "./chat/ChatModelClient";
export type { ChatModelClientOptions } from "./chat/ChatModelClient";

export { EmbeddingClient } from "./embeddings/EmbeddingClient";
export type { EmbeddingClientOptions } from "./embeddings/EmbeddingClient";

export { ChatCompletionsRoundAdapter } from "./chat/rounds/ChatCompletionsRoundAdapter";
export { FallbackModelRoundProvider } from "./chat/rounds/FallbackModelRoundProvider";

export { resolveResponsesProviderPolicy } from "./chat/responses/ResponsesProviderPolicy";
export type {
  ResponsesPolicyDecision,
  ResponsesPolicyInput,
} from "./chat/responses/ResponsesProviderPolicy";

export { OpenAiResponsesClient } from "./chat/responses/OpenAiResponsesClient";
export type { OpenAiResponsesClientOptions } from "./chat/responses/OpenAiResponsesClient";

export {
  contextLengthFromModelMetadata,
  isOllamaTagsResponse,
  isOpenAiModelsResponse,
  modelNamesFromOllamaTags,
  modelNamesFromOpenAiModels,
} from "./common/models";
export type { OllamaTagsResponse, OpenAiModelsResponse } from "./common/models";
