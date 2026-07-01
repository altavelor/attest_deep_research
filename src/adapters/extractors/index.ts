// Публичный API модуля adapters/extractors — извлекатели текста по форматам,
// PDF-кэш и общий помощник stableId. Прочие утилиты `common.ts` (чанкинг,
// XML-хелперы, ZipArchive) — внутренняя реализация модуля.
//
// Инвариант: файлы ВНУТРИ модуля не импортируют этот баррель — только соседей
// через `./…`, иначе цикл (ловит `npm run depcruise`).

export { DocxExtractor } from "./DocxExtractor";
export { EpubExtractor } from "./EpubExtractor";
export { Fb2Extractor } from "./Fb2Extractor";
export { TextExtractor } from "./TextExtractor";

export { MarkdownExtractor } from "./MarkdownExtractor";
export type { MarkdownExtractorOptions } from "./MarkdownExtractor";

export { PdfExtractor, PdfJsTextParser, SimplePdfTextParser } from "./PdfExtractor";
export type { PdfExtractorOptions, PdfPageText, PdfPageTextParser } from "./PdfExtractor";

export { PdfTextCache } from "./PdfTextCache";
export type { PdfTextCacheEntry, PdfTextCacheKey } from "./PdfTextCache";

export { stableId } from "./common";
