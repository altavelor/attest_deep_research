import { Extractor, ExtractorInput } from "@application/ports";
import { ExtractedChunk } from "@core/model";
import {
  createDocumentChunks,
  DEFAULT_CHUNK_OVERLAP,
  DEFAULT_CHUNK_LENGTH,
  DocumentExtractorOptions,
  extractionFailed,
  normalizePath,
  readInputText,
  stripXmlTags,
} from "./common";

export class Fb2Extractor implements Extractor {
  private readonly maxChunkLength: number;
  private readonly chunkOverlap: number;

  constructor(options: DocumentExtractorOptions = {}) {
    this.maxChunkLength = options.maxChunkLength ?? DEFAULT_CHUNK_LENGTH;
    this.chunkOverlap = options.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP;
  }

  supports(path: string): boolean {
    return path.toLowerCase().endsWith(".fb2");
  }

  async extract(input: ExtractorInput): Promise<ExtractedChunk[]> {
    if (!this.supports(input.path)) {
      return [];
    }

    try {
      const source = readInputText(input.data);
      const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(source)?.[1];

      if (!body) {
        throw new Error("FB2 body was not found.");
      }

      return createDocumentChunks({
        path: normalizePath(input.path),
        format: "fb2",
        text: stripXmlTags(body),
        maxChunkLength: this.maxChunkLength,
        chunkOverlap: this.chunkOverlap,
      });
    } catch (error) {
      throw extractionFailed("fb2", input.path, error);
    }
  }
}
