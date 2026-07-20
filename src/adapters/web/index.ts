// Публичный API модуля adapters/web — провайдер веб-поиска, проверка URL и
// парсеры HTML. Внешние потребители импортируют `@adapters/web`.
//
// Инвариант: файлы ВНУТРИ модуля не импортируют этот баррель — только соседей
// через `./…`, иначе цикл (ловит `npm run depcruise`).

export { DuckDuckGoSearchProvider } from "./DuckDuckGoSearchProvider";
export type { DuckDuckGoSearchProviderOptions } from "./DuckDuckGoSearchProvider";

export { FetchUrlStatusChecker } from "./FetchUrlStatusChecker";
export type { FetchUrlStatusCheckerOptions } from "./FetchUrlStatusChecker";

export {
  extractPageMetadata,
  extractReadableText,
  parseDuckDuckGoResults,
} from "./DuckDuckGoParser";
export type { DuckDuckGoResult, PageMetadata } from "./DuckDuckGoParser";

export {
  createWebSearchSources,
  createWebSourceRegistry,
  WEB_SOURCE_DEFINITIONS,
} from "./sources/registry";
export type { WebSourceRuntimeOptions } from "./sources/registry";
export { HttpWebSearchSource } from "./sources/HttpWebSearchSource";
export type { HttpWebSearchSourceOptions } from "./sources/HttpWebSearchSource";

export { createFetchFallbackProviders } from "./fetch/fallbacks";
export { JinaReaderFetchProvider } from "./fetch/JinaReaderFetchProvider";
export { ZyteFetchProvider } from "./fetch/ZyteFetchProvider";
export { WaybackFetchProvider } from "./fetch/WaybackFetchProvider";
