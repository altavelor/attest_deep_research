// Публичный API application/ports — порт-интерфейсы для адаптеров (чат, индекс,
// ретрив, vault, web). Внешние потребители импортируют `@application/ports`.
// Чистые интерфейсы без приватной реализации → пофайловый `export *`.
//
// Инвариант: файлы ВНУТРИ модуля не импортируют этот баррель — только соседей
// через `./…`, иначе цикл (ловит `npm run depcruise`).

export * from "./chat";
export * from "./documentClaims";
export * from "./documentMetadata";
export * from "./documentSummaries";
export * from "./images";
export * from "./indexing";
export * from "./retrieval";
export * from "./vault";
export * from "./web";
