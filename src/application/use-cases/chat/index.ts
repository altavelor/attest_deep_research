// Публичный API модуля use-cases/chat — компакция истории чата и сборка
// контекста. Внешние потребители импортируют `@application/use-cases/chat`.
//
// Инвариант: файлы ВНУТРИ модуля не импортируют этот баррель — только соседей
// через `./…`, иначе цикл (ловит `npm run depcruise`).

export * from "./ChatCompaction";
export * from "./ContextAssembler";
