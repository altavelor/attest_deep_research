// Публичный API подмодуля adapters/extractors/images — извлечение ссылок на
// изображения из поддерживаемых форматов документов. Реэкспортируется из
// `@adapters/extractors`.
//
// Инвариант: файлы ВНУТРИ модуля не импортируют этот баррель — только соседей
// через `./…`, иначе цикл (ловит `npm run depcruise`).

export {
  documentImageCandidates,
  extractDocumentImages,
  supportsDocumentImages,
} from "./documentImages";
export { DocxImageExtractor, EpubImageExtractor } from "./archiveImages";
export { extractFb2ImageRefs, Fb2ImageExtractor } from "./fb2Images";
export {
  extractMarkdownImageRefs,
  MarkdownImageExtractor,
  TextImageExtractor,
} from "./markdownImages";
export { extractPdfImageRefs, PdfImageExtractor } from "./pdfImages";
export type {
  DocumentImageExtractor,
  DocumentImageInput,
  DocumentImageRef,
  LinkedPathResolver,
} from "./types";
