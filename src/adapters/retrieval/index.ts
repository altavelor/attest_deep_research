// Публичный API модуля adapters/retrieval — сервисы поиска, расширения запросов
// и keyword-ранжирование. Внешние потребители импортируют `@adapters/retrieval`.
//
// Инвариант: файлы ВНУТРИ модуля не импортируют этот баррель — только соседей
// через `./…`, иначе цикл (ловит `npm run depcruise`).

export { buildQueryExpansionPrompt, parseQueryVariants, QueryExpansionService } from "./QueryExpansionService";
export type {
  BuildQueryVariantsOptions,
  QueryExpansionDiagnostic,
  QueryExpansionServiceOptions,
} from "./QueryExpansionService";

export { RetrievalService } from "./RetrievalService";
export type { RetrievalResult, RetrievalServiceOptions } from "./RetrievalService";

export { rankKeywordMatches } from "./keywordRanking";
