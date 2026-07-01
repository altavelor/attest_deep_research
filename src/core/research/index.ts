// Публичный API доменного модуля core/research — построение промптов (обычных,
// агентных), политика исполнения, граф-контекст, режимы поиска, планировщик
// доказательств и директива универсального суб-агента. Внешние потребители
// импортируют `@core/research`.
//
// Все файлы модуля публичны (чистая доменная логика без приватной реализации),
// поэтому здесь уместен пофайловый `export *`; дубликатов имён между файлами нет
// (проверяет `tsc`). Инвариант: файлы ВНУТРИ модуля не импортируют этот баррель
// — только соседей через `./…`, иначе цикл (ловит `npm run depcruise`).

export * from "./prompts";
export * from "./agenticPrompts";
export * from "./ResearchExecutionPolicy";
export * from "./GraphContext";
export * from "./searchMode";
export * from "./evidence-planner/EvidencePlanner";
export * from "./subAgent/subAgentDirective";
