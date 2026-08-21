export const MOBILE_EMBEDDING_BATCH_SIZE = 8;
export const MOBILE_PDF_PAGE_CONCURRENCY = 1;
export const MOBILE_CHANGED_FILES_PER_RUN = 50;
export const MOBILE_MAX_PDF_BYTES = 10 * 1024 * 1024;

export function effectiveEmbeddingBatchSize(configured: number, isMobile: boolean): number {
  return isMobile ? Math.min(configured, MOBILE_EMBEDDING_BATCH_SIZE) : configured;
}

export function mobileIndexingOptions(isMobile: boolean): {
  yieldEveryFiles?: number;
  maxChangedFilesPerRun?: number;
} {
  return isMobile
    ? { yieldEveryFiles: 1, maxChangedFilesPerRun: MOBILE_CHANGED_FILES_PER_RUN }
    : {};
}

export function pdfPageConcurrency(isMobile: boolean): number | undefined {
  return isMobile ? MOBILE_PDF_PAGE_CONCURRENCY : undefined;
}

export function mobileFileSizeLimits(
  isMobile: boolean,
): Readonly<Record<string, number>> | undefined {
  return isMobile ? { pdf: MOBILE_MAX_PDF_BYTES } : undefined;
}
