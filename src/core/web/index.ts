// Публичный API модуля core/web — доменная логика веба: ранжирование секций
// страницы и статический каталог внешних поисковых источников.
//
// Инвариант: файлы ВНУТРИ модуля не импортируют этот баррель — только соседей
// через `./…`, иначе цикл (ловит `npm run depcruise`).

export { rankSectionsByQuery, splitIntoSections } from "./sectionRanking";
export type { RankedSection, SectionRankingOptions } from "./sectionRanking";

export { WEB_SOURCE_CATALOG, findWebSourceDescriptor, areCredentialsComplete } from "./webSources";
export type {
  WebSourceCategory,
  WebSourceCredentialField,
  WebSourceDescriptor,
  WebSourceProfile,
} from "./webSources";
