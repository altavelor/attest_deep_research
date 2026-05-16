import { ExtractedChunk, Extractor, ExtractorInput } from "../shared/types";
import {
  createDocumentChunks,
  DEFAULT_CHUNK_LENGTH,
  DocumentExtractorOptions,
  normalizePath,
  readInputText,
} from "./common";

export class TextExtractor implements Extractor {
  private readonly maxChunkLength: number;

  constructor(options: DocumentExtractorOptions = {}) {
    this.maxChunkLength = options.maxChunkLength ?? DEFAULT_CHUNK_LENGTH;
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
    });
  }
}
