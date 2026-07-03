// Публичный API модуля adapters/indexing — сервис индексации, контроллеры,
// векторный стор (через FileVectorIndexStore/Reader), инвентарь индекса,
// pipeline-хелперы (чанкер, детекция изменений/языка) и keyword-индекс.
//
// Внутренняя реализация НЕ выставляется: движок pipeline (FileProcessor,
// EmbeddingBatcher, IndexWriteCoordinator), внутренности стора
// (FileVectorIndex{State,Vector,Format,Persistence,Query,Language,Errors}),
// FileVectorIndexInventory[Text], IndexingProgressState и types — приватны и
// подключаются относительно; их white-box юнит-тесты обращаются к ним напрямую.
//
// Инвариант: файлы ВНУТРИ модуля не импортируют этот баррель — только соседей
// через `./…`, иначе цикл (ловит `npm run depcruise`). Публичные файлы сами
// реэкспортируют нужные типы (напр. IndexingService → IndexingState), поэтому
// пофайловый `export *` достаточен; коллизий имён между ними нет (проверяет tsc).

export * from "./IndexingService";

export * from "./controller/IndexingController";
export * from "./controller/IndexingProfileController";

export * from "./inventory/FileVectorInventoryStore";
export * from "./inventory/IndexDescription";
export * from "./inventory/fileIndexFiles";
export * from "./inventory/indexSize";
export * from "./inventory/sourcePathShard";

export * from "./keyword/LightweightKeywordIndex";

export * from "./metadata/FileDocumentMetadataStore";
export * from "./metadata/LlmDocumentMetadataExtractor";

export * from "./pipeline/changeDetection";
export * from "./pipeline/chunker";
export * from "./pipeline/languageDetection";

export * from "./store/FileVectorIndexReader";
export * from "./store/FileVectorIndexStore";
