// Публичный API модуля application/web — планировщик веб-запросов хаба
// внешних источников. Внешние потребители импортируют `@application/web`.
//
// Инвариант: файлы ВНУТРИ модуля не импортируют этот баррель — только соседей
// через `./…`, иначе цикл (ловит `npm run depcruise`).

export { WebQueryPlanner } from "./WebQueryPlanner";
export type { WebQueryPlannerOptions } from "./WebQueryPlanner";

export { FetchFallbackChain } from "./FetchFallbackChain";
export type { FetchFallbackChainOptions } from "./FetchFallbackChain";

export { WebSourceHealthTracker } from "./WebSourceHealthTracker";
export type {
  WebSourceHealthTrackerOptions,
  WebSourceIssue,
  WebSourceIssueReason,
} from "./WebSourceHealthTracker";
