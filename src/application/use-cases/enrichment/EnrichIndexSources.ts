// Use-case (SPEC-corpus-knowledge R3+R4): per indexed source whose content
// changed since the last run — extract document metadata (title/authors/year/
// abstract/references) and, when a summarizer is wired, generate hierarchical
// summaries (per section + per document). LLM and storage enter through ports;
// this class only orchestrates.

import {
  DocumentMetadataExtractor,
  DocumentMetadataStore,
  DocumentSummarizer,
  DocumentSummaryStore,
  IndexChunkListItem,
  IndexSourceOutline,
  SourceDocumentMetadata,
  SourceDocumentSummaries,
} from "@application/ports";
import { ResearchRetriever } from "@application/contracts";
import { toDocumentReference } from "./bibliography";
import {
  buildSectionSummaryGroups,
  PreparedSection,
  SECTION_TEXT_CHARS,
  sectionTextHash,
  shouldUseSmallDocumentFastPath,
  summarizableSections,
} from "./SectionSummaryPlanner";
import {
  DEFAULT_RETRY_BACKOFF_MS,
  DEFAULT_SECTION_SUMMARY_CONCURRENCY,
  summarizeSectionGroups,
} from "./SectionSummaryScheduler";

export interface EnrichIndexSourcesOptions {
  retriever: ResearchRetriever;
  metadataStore: DocumentMetadataStore;
  extractor: DocumentMetadataExtractor;
  /** Optional summary task (R4): absent ⇒ metadata only. */
  summaryStore?: DocumentSummaryStore;
  summarizer?: DocumentSummarizer;
  now?: () => Date;
  /** Characters of document head/tail handed to the extractor. */
  sampleChars?: number;
  /** Max concurrent section-level LLM requests. */
  sectionSummaryConcurrency?: number;
  /** Initial delay between retry attempts for transient LLM failures. */
  retryBackoffMs?: number;
}

export interface EnrichmentProgress {
  processed: number;
  total: number;
  sourcePath: string;
  /** "working" — промежуточный прогресс внутри источника (фазы ниже). */
  status: "working" | "extracted" | "skipped" | "failed";
  /** Set when status === "working". */
  phase?: "metadata" | "sections" | "document";
  sectionIndex?: number;
  sectionCount?: number;
  error?: string;
}

export interface EnrichmentRunResult {
  extracted: number;
  skipped: number;
  failed: number;
}

const DEFAULT_SAMPLE_CHARS = 8_000;
const HEAD_CHUNK_LIMIT = 8;
const TAIL_CHUNK_LIMIT = 10;
const REFERENCES_HEADING = /references|bibliography|literature|литератур|источник/i;
const SOURCE_PAGE_LIMIT = 500;

export class EnrichIndexSources {
  private readonly retriever: ResearchRetriever;
  private readonly metadataStore: DocumentMetadataStore;
  private readonly extractor: DocumentMetadataExtractor;
  private readonly summaryStore?: DocumentSummaryStore;
  private readonly summarizer?: DocumentSummarizer;
  private readonly now: () => Date;
  private readonly sampleChars: number;
  private readonly sectionSummaryConcurrency: number;
  private readonly retryBackoffMs: number;

  constructor(options: EnrichIndexSourcesOptions) {
    this.retriever = options.retriever;
    this.metadataStore = options.metadataStore;
    this.extractor = options.extractor;
    this.summaryStore = options.summaryStore;
    this.summarizer = options.summarizer;
    this.now = options.now ?? (() => new Date());
    this.sampleChars = options.sampleChars ?? DEFAULT_SAMPLE_CHARS;
    this.sectionSummaryConcurrency = Math.max(
      1,
      Math.floor(options.sectionSummaryConcurrency ?? DEFAULT_SECTION_SUMMARY_CONCURRENCY),
    );
    this.retryBackoffMs = Math.max(0, options.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS);
  }

  async run(
    options: {
      signal?: AbortSignal;
      /** Re-extract even when the stored contentHash matches (user-forced refresh). */
      force?: boolean;
      onProgress?: (progress: EnrichmentProgress) => void;
    } = {},
  ): Promise<EnrichmentRunResult> {
    const sources = await this.listAllSources();
    const result: EnrichmentRunResult = { extracted: 0, skipped: 0, failed: 0 };
    let processed = 0;

    for (const source of sources) {
      if (options.signal?.aborted) {
        break;
      }
      processed += 1;

      const contentHash = source.contentHash ?? "";
      const [storedMetadata, storedSummaries] = await Promise.all([
        this.metadataStore.read(source.sourcePath),
        this.summaryStore ? this.summaryStore.read(source.sourcePath) : Promise.resolve(null),
      ]);
      const metadataFresh =
        !options.force && Boolean(contentHash) && storedMetadata?.contentHash === contentHash;
      const summariesFresh =
        !this.summarizer ||
        !this.summaryStore ||
        (!options.force && Boolean(contentHash) && storedSummaries?.contentHash === contentHash);

      if (metadataFresh && summariesFresh) {
        result.skipped += 1;
        options.onProgress?.({
          processed,
          total: sources.length,
          sourcePath: source.sourcePath,
          status: "skipped",
        });
        continue;
      }

      const working = (
        progress: Pick<EnrichmentProgress, "phase" | "sectionIndex" | "sectionCount">,
      ) =>
        options.onProgress?.({
          processed,
          total: sources.length,
          sourcePath: source.sourcePath,
          status: "working",
          ...progress,
        });

      try {
        let title = storedMetadata?.title;
        if (!metadataFresh) {
          working({ phase: "metadata" });
          const metadata = await this.extractSource(source.sourcePath, contentHash);
          await this.metadataStore.write(metadata);
          title = metadata.title;
        }
        if (!summariesFresh && this.summarizer && this.summaryStore) {
          await this.summaryStore.write(
            await this.summarizeSource(
              source.sourcePath,
              contentHash,
              title,
              options.force ? null : storedSummaries,
              working,
            ),
          );
        }
        result.extracted += 1;
        options.onProgress?.({
          processed,
          total: sources.length,
          sourcePath: source.sourcePath,
          status: "extracted",
        });
      } catch (error) {
        result.failed += 1;
        options.onProgress?.({
          processed,
          total: sources.length,
          sourcePath: source.sourcePath,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return result;
  }

  private async listAllSources() {
    if (!this.retriever.listIndexSources) {
      return [];
    }
    const sources = [];
    let cursor: string | undefined;
    do {
      const page = await this.retriever.listIndexSources({ limit: SOURCE_PAGE_LIMIT, cursor });
      sources.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    return sources;
  }

  private async extractSource(
    sourcePath: string,
    contentHash: string,
  ): Promise<SourceDocumentMetadata> {
    const { headSample, referencesSample } = await this.collectSamples(sourcePath);
    const extracted = await this.extractor.extract({ sourcePath, headSample, referencesSample });

    return {
      schemaVersion: 1,
      sourcePath,
      contentHash,
      ...(extracted.title ? { title: extracted.title } : {}),
      ...(extracted.authors && extracted.authors.length > 0 ? { authors: extracted.authors } : {}),
      ...(extracted.year ? { year: extracted.year } : {}),
      ...(extracted.abstract ? { abstract: extracted.abstract } : {}),
      references: extracted.references.map(toDocumentReference),
      extraction: {
        model: this.extractor.model,
        promptVersion: this.extractor.promptVersion,
        extractedAt: this.now().toISOString(),
      },
    };
  }

  /**
   * Hierarchical summaries (R4): summarize each outline section (bounded), then
   * reduce section summaries into a document summary + one-liner. Documents
   * without sections are summarized from the head sample directly.
   */
  private async summarizeSource(
    sourcePath: string,
    contentHash: string,
    title: string | undefined,
    previousSummaries: SourceDocumentSummaries | null,
    working?: (
      progress: Pick<EnrichmentProgress, "phase" | "sectionIndex" | "sectionCount">,
    ) => void,
  ): Promise<SourceDocumentSummaries> {
    const summarizer = this.summarizer!;
    const outline = await this.retriever.getIndexSourceOutline?.(sourcePath);
    const previousByHash = new Map(
      (previousSummaries?.sections ?? [])
        .filter((section) => section.sectionHash)
        .map((section) => [section.sectionHash!, section]),
    );
    const sections = shouldUseSmallDocumentFastPath(outline)
      ? []
      : await summarizeSectionGroups({
          summarizer,
          sourcePath,
          groups: await this.prepareSectionGroups(sourcePath, outline, working),
          previousByHash,
          concurrency: this.sectionSummaryConcurrency,
          retryBackoffMs: this.retryBackoffMs,
          onProgress: (progress) => working?.({ phase: "sections", ...progress }),
        });

    working?.({ phase: "document" });
    const sectionSummaries =
      sections.length > 0
        ? sections.map((section) => `${section.headingPath.join(" > ")}: ${section.summary}`)
        : [(await this.collectSamples(sourcePath)).headSample].filter(Boolean);
    const document = await summarizer.summarizeDocument({
      sourcePath,
      title,
      sectionSummaries,
    });

    return {
      schemaVersion: 1,
      sourcePath,
      contentHash,
      sections,
      document,
      generation: {
        model: summarizer.model,
        promptVersion: summarizer.promptVersion,
        generatedAt: this.now().toISOString(),
      },
    };
  }

  private async prepareSectionGroups(
    sourcePath: string,
    outline: IndexSourceOutline | null | undefined,
    working?: (
      progress: Pick<EnrichmentProgress, "phase" | "sectionIndex" | "sectionCount">,
    ) => void,
  ) {
    const outlineSections = summarizableSections(outline);

    const prepared: PreparedSection[] = [];
    for (const [index, section] of outlineSections.entries()) {
      working?.({
        phase: "sections",
        sectionIndex: index + 1,
        sectionCount: outlineSections.length,
      });
      const text = await this.sectionText(sourcePath, section.headingPath);
      if (!text) {
        continue;
      }
      prepared.push({
        headingPath: section.headingPath,
        chunkStart: section.chunkStart,
        chunkEnd: section.chunkEnd,
        charCount: section.charCount,
        text,
        sectionHash: sectionTextHash(section.headingPath, text),
      });
    }

    return buildSectionSummaryGroups(prepared);
  }

  private async sectionText(sourcePath: string, headingPath: string[]): Promise<string> {
    if (!this.retriever.listIndexChunks) {
      return "";
    }
    const chunks = await this.retriever.listIndexChunks({
      sourcePath,
      limit: TAIL_CHUNK_LIMIT,
      headingPath,
    });
    const sample = await this.sampleFromChunks(chunks.items);
    return sample.slice(0, SECTION_TEXT_CHARS);
  }

  /**
   * Head sample: the first chunks (title page, abstract). References sample:
   * chunks under a references-like heading when the outline knows one,
   * otherwise the document tail.
   */
  private async collectSamples(
    sourcePath: string,
  ): Promise<{ headSample: string; referencesSample: string }> {
    if (!this.retriever.listIndexChunks) {
      return { headSample: "", referencesSample: "" };
    }

    const head = await this.retriever.listIndexChunks({
      sourcePath,
      limit: HEAD_CHUNK_LIMIT,
    });
    const headSample = await this.sampleFromChunks(head.items);

    const referencesHeading = await this.findReferencesHeading(sourcePath);
    if (referencesHeading) {
      const chunks = await this.retriever.listIndexChunks({
        sourcePath,
        limit: TAIL_CHUNK_LIMIT,
        headingPath: referencesHeading,
      });
      if (chunks.items.length > 0) {
        return { headSample, referencesSample: await this.sampleFromChunks(chunks.items) };
      }
    }

    return { headSample, referencesSample: await this.tailSample(sourcePath) };
  }

  /**
   * Full chunk text for a sample. `listIndexChunks` returns 500-char previews —
   * feeding those to the extractor made it fall back on the model's own
   * knowledge of famous works and lose bibliographies. When the retriever can
   * read chunks, re-read the contiguous run in full within the sample budget.
   */
  private async sampleFromChunks(items: IndexChunkListItem[]): Promise<string> {
    if (items.length === 0) {
      return "";
    }
    if (this.retriever.readIndexChunk) {
      const read = await this.retriever.readIndexChunk({
        chunkId: items[0].chunkId,
        before: 0,
        after: items.length - 1,
        maxChars: this.sampleChars,
      });
      if (read.chunks.length > 0) {
        return read.chunks
          .map((chunk) => chunk.text)
          .join("\n")
          .slice(0, this.sampleChars);
      }
    }
    return joinChunkTexts(items, this.sampleChars);
  }

  private async findReferencesHeading(sourcePath: string): Promise<string[] | undefined> {
    const outline = await this.retriever.getIndexSourceOutline?.(sourcePath);
    const section = outline?.sections.find((candidate) =>
      REFERENCES_HEADING.test(candidate.headingPath.join(" ")),
    );
    return section?.headingPath;
  }

  private async tailSample(sourcePath: string): Promise<string> {
    if (!this.retriever.listIndexChunks) {
      return "";
    }
    // Хвост документа: последняя страница курсора. Дешевле, чем полный проход:
    // берём общий размер из outline, если он есть, иначе один проход курсором.
    const outline = await this.retriever.getIndexSourceOutline?.(sourcePath);
    const chunkCount = outline?.chunkCount;
    if (chunkCount && chunkCount > TAIL_CHUNK_LIMIT) {
      const page = await this.retriever.listIndexChunks({
        sourcePath,
        limit: TAIL_CHUNK_LIMIT,
        cursor: String(chunkCount - TAIL_CHUNK_LIMIT),
      });
      return this.sampleFromChunks(page.items);
    }
    const page = await this.retriever.listIndexChunks({ sourcePath, limit: TAIL_CHUNK_LIMIT });
    return this.sampleFromChunks(page.items);
  }
}

function joinChunkTexts(items: IndexChunkListItem[], maxChars: number): string {
  let text = "";
  for (const item of items) {
    if (text.length >= maxChars) {
      break;
    }
    text += `${item.textPreview}\n`;
  }
  return text.slice(0, maxChars);
}
