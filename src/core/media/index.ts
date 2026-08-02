// Публичный API модуля core/media — DTO артефактов ответа, политика
// допустимости изображений, нормализованный кандидат и валидация графиков.
// Внешние потребители импортируют `@core/media`.
//
// Инвариант: файлы ВНУТРИ модуля не импортируют этот баррель — только соседей
// через `./…`, иначе цикл (ловит `npm run depcruise`).

export {
  ARTIFACT_LIMITS,
  CHART_TYPES,
  isAnswerArtifact,
  isAnswerImage,
  sanitizeAnswerArtifacts,
} from "./artifacts";
export type {
  AnswerArtifact,
  AnswerImage,
  AnswerImageVaultSource,
  ChartArtifact,
  ChartPoint,
  ChartSeries,
  ChartType,
  ImageGalleryArtifact,
} from "./artifacts";

export {
  ELIGIBLE_IMAGE_FORMATS,
  hasDisplayableDimensions,
  IMAGE_EXTRACTION_LIMITS,
  imageFormatFromMimeType,
  imageFormatFromPath,
  isSafeVaultImagePath,
  mimeTypeForFormat,
  validateImageUrl,
} from "./imagePolicy";
export type { EligibleImageFormat, ImageUrlCheck } from "./imagePolicy";

export { imageQueryVariants } from "./imageQuery";
export { clampText, toAnswerImage } from "./imageCandidate";
export type { ImageCandidate, ImageCandidateOrigin } from "./imageCandidate";

export { chartDataTable, formatNumber, validateChartInput } from "./chartInput";
export type { ChartValidation } from "./chartInput";
