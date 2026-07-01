import { Extractor, ExtractorInput } from "@application/ports";
import { ExtractedChunk } from "@core/model";
import {
  createDocumentChunks,
  decodeXmlEntities,
  DEFAULT_CHUNK_OVERLAP,
  DEFAULT_CHUNK_LENGTH,
  DocumentExtractorOptions,
  extractionFailed,
  normalizePath,
  ZipArchive,
} from "./common";

export class DocxExtractor implements Extractor {
  private readonly maxChunkLength: number;
  private readonly chunkOverlap: number;

  constructor(options: DocumentExtractorOptions = {}) {
    this.maxChunkLength = options.maxChunkLength ?? DEFAULT_CHUNK_LENGTH;
    this.chunkOverlap = options.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP;
  }

  supports(path: string): boolean {
    return path.toLowerCase().endsWith(".docx");
  }

  async extract(input: ExtractorInput): Promise<ExtractedChunk[]> {
    if (!this.supports(input.path)) {
      return [];
    }

    try {
      const documentXml = ZipArchive.read(input.data).text("word/document.xml");

      if (!documentXml) {
        throw new Error("DOCX document XML was not found.");
      }

      return createDocumentChunks({
        path: normalizePath(input.path),
        format: "docx",
        text: extractDocxText(documentXml),
        maxChunkLength: this.maxChunkLength,
        chunkOverlap: this.chunkOverlap,
      });
    } catch (error) {
      throw extractionFailed("docx", input.path, error);
    }
  }
}

function extractDocxText(documentXml: string): string {
  return [...documentXml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/gi)]
    .map((paragraph) =>
      [...paragraph[1].matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gi)]
        .map((text) => decodeXmlEntities(text[1]))
        .join(""),
    )
    .filter(Boolean)
    .join("\n\n");
}
