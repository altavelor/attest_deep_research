// Use-case (SPEC-corpus-knowledge R3): extract per-source document metadata
// (title/authors/year/abstract/references) for every indexed source whose
// content changed since the last enrichment. LLM and storage enter through
// ports; this class only orchestrates.

import {
  DocumentMetadataExtractor,
  DocumentMetadataStore,
  IndexChunkListItem,
  SourceDocumentMetadata,
} from "@application/ports";
import { ResearchRetriever } from "@application/contracts";
import { toDocumentReference } from "./bibliography";

export interface EnrichIndexSourcesOptions {
  retriever: ResearchRetriever;
  metadataStore: DocumentMetadataStore;
  extractor: DocumentMetadataExtractor;
  now?: () => Date;
  /** Characters of document head/tail handed to the extractor. */
  sampleChars?: number;
}

export interface EnrichmentProgress {
  processed: number;
  total: number;
  sourcePath: string;
  status: "extracted" | "skipped" | "failed";
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
  private readonly now: () => Date;
  private readonly sampleChars: number;

  constructor(options: EnrichIndexSourcesOptions) {
    this.retriever = options.retriever;
    this.metadataStore = options.metadataStore;
    this.extractor = options.extractor;
    this.now = options.now ?? (() => new Date());
    this.sampleChars = options.sampleChars ?? DEFAULT_SAMPLE_CHARS;
  }

  async run(options: {
    signal?: AbortSignal;
    /** Re-extract even when the stored contentHash matches (user-forced refresh). */
    force?: boolean;
    onProgress?: (progress: EnrichmentProgress) => void;
  } = {}): Promise<EnrichmentRunResult> {
    const sources = await this.listAllSources();
    const result: EnrichmentRunResult = { extracted: 0, skipped: 0, failed: 0 };
    let processed = 0;

    for (const source of sources) {
      if (options.signal?.aborted) {
        break;
      }
      processed += 1;

      const existing = options.force ? null : await this.metadataStore.read(source.sourcePath);
      if (existing && source.contentHash && existing.contentHash === source.contentHash) {
        result.skipped += 1;
        options.onProgress?.({
          processed,
          total: sources.length,
          sourcePath: source.sourcePath,
          status: "skipped",
        });
        continue;
      }

      try {
        const metadata = await this.extractSource(source.sourcePath, source.contentHash ?? "");
        await this.metadataStore.write(metadata);
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
