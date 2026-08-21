import {
  MOBILE_CHANGED_FILES_PER_RUN,
  MOBILE_EMBEDDING_BATCH_SIZE,
  effectiveEmbeddingBatchSize,
  mobileIndexingOptions,
  mobileFileSizeLimits,
  pdfPageConcurrency,
} from "@apps/obsidian/composition/mobileIndexingPolicy";

describe("mobile indexing policy", () => {
  it("caps expensive work only on mobile", () => {
    expect(effectiveEmbeddingBatchSize(64, true)).toBe(MOBILE_EMBEDDING_BATCH_SIZE);
    expect(effectiveEmbeddingBatchSize(4, true)).toBe(4);
    expect(effectiveEmbeddingBatchSize(64, false)).toBe(64);
    expect(pdfPageConcurrency(true)).toBe(1);
    expect(pdfPageConcurrency(false)).toBeUndefined();
    expect(mobileFileSizeLimits(true)?.pdf).toBe(10 * 1024 * 1024);
    expect(mobileFileSizeLimits(false)).toBeUndefined();
  });

  it("yields after each mobile file and bounds changed files per run", () => {
    expect(mobileIndexingOptions(true)).toEqual({
      yieldEveryFiles: 1,
      maxChangedFilesPerRun: MOBILE_CHANGED_FILES_PER_RUN,
    });
    expect(mobileIndexingOptions(false)).toEqual({});
  });
});
