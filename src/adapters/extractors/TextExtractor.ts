import { Extractor, ExtractorInput } from "@application/ports";
import { ExtractedChunk } from "@core/model";
import {
  createDocumentChunks,
  DEFAULT_CHUNK_OVERLAP,
  DEFAULT_CHUNK_LENGTH,
  DocumentExtractorOptions,
  normalizePath,
  readInputText,
} from "./common";

export class TextExtractor implements Extractor {
  private readonly maxChunkLength: number;
  private readonly chunkOverlap: number;

  constructor(options: DocumentExtractorOptions = {}) {
    this.maxChunkLength = options.maxChunkLength ?? DEFAULT_CHUNK_LENGTH;
    this.chunkOverlap = options.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP;
  }

  supports(path: string): boolean {
    return path.toLowerCase().endsWith(".txt");
  }

  async extract(input: ExtractorInput): Promise<ExtractedChunk[]> {
    if (!this.supports(input.path)) {
      return [];
    }

    return createDocumentChunks({
      path: normalizePath(input.path),
      format: "txt",
      text: readInputText(input.data),
      maxChunkLength: this.maxChunkLength,
      chunkOverlap: this.chunkOverlap,
    });
  }
}
