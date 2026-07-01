// Публичный API доменного ядра core/model — типы источников, чанков и цитат.
// Внешние потребители импортируют `@core/model`. Внутри модуля файлы ссылаются
// друг на друга относительно (`./source`), баррель не импортируют — иначе цикл
// (ловит `npm run depcruise`).

export type {
  Citation,
  LanguageCode,
  LanguageInventoryItem,
} from "./citation";
export type {
  DocumentFormat,
  DocumentSourceReference,
  EmbeddedChunk,
  ExtractedChunk,
  MarkdownSourceReference,
  PdfSourceReference,
  RetrievedChunk,
  SourceKind,
  SourceReference,
  SourceReferenceBase,
  WebSourceReference,
} from "./source";
export { uniqueChunks } from "./source";
