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

export { PdfExtractor, PdfJsTextParser } from "./PdfExtractor";
export type {
  PdfExtractorOptions,
  PdfPageText,
  PdfPageTextParser,
  PdfParsedDocument,
} from "./PdfExtractor";

export { SimplePdfTextParser } from "./pdfSimpleParser";

export {
  headingPathAt,
  headingsFromTypography,
  positionHeadings,
  resolvePdfHeadings,
} from "./pdfHeadings";
export type { PdfHeading, PdfTextLine, PositionedPdfHeading } from "./pdfHeadings";

export { PdfTextCache } from "./PdfTextCache";
export type { PdfTextCacheEntry, PdfTextCacheKey } from "./PdfTextCache";

export { stableId } from "./common";

export {
  documentImageCandidates,
  DocxImageExtractor,
  EpubImageExtractor,
  extractDocumentImages,
  extractFb2ImageRefs,
  extractMarkdownImageRefs,
  extractPdfImageRefs,
  Fb2ImageExtractor,
  MarkdownImageExtractor,
  PdfImageExtractor,
  supportsDocumentImages,
  TextImageExtractor,
} from "./images";
export type { DocumentImageExtractor, DocumentImageInput, DocumentImageRef } from "./images";
