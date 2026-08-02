// Публичный API модуля core/web — доменная логика веба: ранжирование секций
// страницы и статический каталог внешних поисковых источников.
//
// Инвариант: файлы ВНУТРИ модуля не импортируют этот баррель — только соседей
// через `./…`, иначе цикл (ловит `npm run depcruise`).

export { rankSectionsByQuery, splitIntoSections } from "./sectionRanking";
export type { RankedSection, SectionRankingOptions } from "./sectionRanking";

export {
  WEB_SOURCE_CATALOG,
  DUCKDUCKGO_DESCRIPTOR,
  findWebSourceDescriptor,
  areCredentialsComplete,
  IMAGE_SOURCE_IDS,
  isImageSourceId,
  OPENVERSE_SOURCE_ID,
  WIKIMEDIA_COMMONS_SOURCE_ID,
} from "./webSources";

export {
  classifyWebQuery,
  selectSourcesForIntent,
  mergeRankedResults,
  isWebQueryIntent,
  WEB_QUERY_INTENTS,
} from "./queryPlanning";
export type { WebQueryIntent } from "./queryPlanning";

export {
  WEB_QUERY_RECENCIES,
  isWebQueryRecency,
  inferQueryRecency,
  recencyFloor,
  detectQueryLanguage,
  extractSiteFilters,
  stripTemporalNoise,
} from "./queryContext";
export type { WebQueryRecency, WebQueryLanguage, SiteFilterExtraction } from "./queryContext";
export type {
  WebSourceCategory,
  WebSourceCapabilities,
  WebSourceCredentialField,
  WebSourceDescriptor,
  WebSourceProfile,
} from "./webSources";
