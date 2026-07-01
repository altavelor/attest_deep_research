// Публичный API модуля adapters/web — провайдер веб-поиска, проверка URL и
// парсеры HTML. Внешние потребители импортируют `@adapters/web`.
//
// Инвариант: файлы ВНУТРИ модуля не импортируют этот баррель — только соседей
// через `./…`, иначе цикл (ловит `npm run depcruise`).

export { DuckDuckGoSearchProvider } from "./DuckDuckGoSearchProvider";
export type { DuckDuckGoSearchProviderOptions } from "./DuckDuckGoSearchProvider";

export { FetchUrlStatusChecker } from "./FetchUrlStatusChecker";
export type { FetchUrlStatusCheckerOptions } from "./FetchUrlStatusChecker";

export { extractPageMetadata, extractReadableText, parseDuckDuckGoResults } from "./DuckDuckGoParser";
export type { DuckDuckGoResult, PageMetadata } from "./DuckDuckGoParser";
