// Публичный API application/contracts — контракты между use-cases и адаптерами
// (research, retrieval, conversation-view). Внешние потребители импортируют
// `@application/contracts`. Чистые интерфейсы → пофайловый `export *`.
//
// Инвариант: файлы ВНУТРИ модуля не импортируют этот баррель — только соседей
// через `./…`, иначе цикл (ловит `npm run depcruise`).

export * from "./conversationView";
export * from "./research";
export * from "./retrieval";
