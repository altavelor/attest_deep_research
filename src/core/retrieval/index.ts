// Публичный API модуля core/retrieval — чистые функции и типы поиска/цитат.
// Модуль утилитарный: приватной реализации нет, наружу выставлена вся
// поверхность. Внешние потребители импортируют `@core/retrieval`.
//
// Инвариант: файлы ВНУТРИ модуля не импортируют этот баррель — только соседей
// через `./…`, иначе цикл (ловит `npm run depcruise`).

export { formatCitation, sourceLabel } from "./citations";
export { chunkMatchesRetrievalOptions, filterRetrievedChunks } from "./filters";
export type { RetrievalOptions, RetrievalQueryVariant } from "./query";
export { tokenizeForSearch, tokenSetForSearch } from "./tokenization";
