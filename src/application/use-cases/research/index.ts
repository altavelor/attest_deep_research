// Публичный API модуля use-cases/research.
//
// Внешние потребители (composition root, UI, тесты контракта) импортируют ТОЛЬКО
// отсюда: `import { … } from "@application/use-cases/research"`. Оркестратор
// `ResearchService` и его публичные коллабораторы (диагностика прогона,
// форматтеры ответа, ссылки цитат) — публичны; сами стратегии, пайплайны и
// deep-research-агент остаются внутренней реализацией.
//
// Инвариант: файлы ВНУТРИ модуля не импортируют этот баррель — только соседей
// через `./…`, иначе цикл (ловит `npm run depcruise`).

export { ResearchService } from "./ResearchService";
export type {
  ResearchSearchMode,
  ResearchServiceOptions,
  ResearchStreamEvent,
} from "./ResearchService";

export { AgentRunDiagnosticCollector } from "./AgentRunDiagnostics";
export type { AgentRunDiagnosticCollectorOptions } from "./AgentRunDiagnostics";

export {
  formatResearchAnswerAppendBlock,
  formatResearchAnswerNote,
  researchAnswerNotePath,
} from "./answerFormatter";

export { citationTarget, formatCitationLink } from "./citationLinks";

export { linkifyUrlCitations, shortUrlCitationLabel } from "./urlCitations";
export type { LinkifyUrlCitationsOptions } from "./urlCitations";
