// Публичный API application/research — порты и типы research-оркестрации
// (tool-порты, sub-agent-порт, bounded-search input, метки tool-call).
// Внешние потребители импортируют `@application/research`. Пофайловый `export *`.
//
// Инвариант: файлы ВНУТРИ модуля не импортируют этот баррель — только соседей
// через `./…`, иначе цикл (ловит `npm run depcruise`).

export * from "./boundedSearchInput";
export * from "./subAgentPort";
export * from "./toolCallLabel";
export * from "./toolPorts";
