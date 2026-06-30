import { IxplorerSettings } from "../settings/types";
import { Extractor, ExtractorInput } from "../../application/ports/indexing";
import { ExtractedChunk } from "../../core/model/source";
import { chunkMarkdown } from "../indexing/pipeline/chunker";
import { isPathIncluded, normalizeVaultPath, vaultPathMatchesGlob } from "../../shared/pathFilters";
import { readInputText } from "./common";

export interface MarkdownExtractorOptions {
  includeFolders?: string[];
  excludeGlobs?: string[];
  maxChunkLength?: number;
  chunkOverlap?: number;
}

export class MarkdownExtractor implements Extractor {
  private readonly includeFolders: string[];
  private readonly excludeGlobs: string[];
  private readonly maxChunkLength?: number;
  private readonly chunkOverlap?: number;

  constructor(options: MarkdownExtractorOptions = {}) {
    this.includeFolders = options.includeFolders ?? ["/"];
    this.excludeGlobs = options.excludeGlobs ?? [];
    this.maxChunkLength = options.maxChunkLength;
    this.chunkOverlap = options.chunkOverlap;
  }

  static fromSettings(settings: IxplorerSettings): MarkdownExtractor {
    return new MarkdownExtractor({
      includeFolders: settings.includeFolders,
      excludeGlobs: settings.excludeGlobs,
    });
  }

  supports(path: string): boolean {
    return path.toLowerCase().endsWith(".md") && this.shouldExtractPath(path);
  }

  shouldExtractPath(path: string): boolean {
    const normalizedPath = normalizeVaultPath(path);

    return (
      isPathIncluded(normalizedPath, this.includeFolders) &&
      !this.excludeGlobs.some((glob) => vaultPathMatchesGlob(normalizedPath, glob))
    );
  }

  async extract(input: ExtractorInput): Promise<ExtractedChunk[]> {
    if (!this.supports(input.path)) {
      return [];
    }

    return chunkMarkdown({
      path: normalizeVaultPath(input.path),
      text: readInputText(input.data),
      maxChunkLength: this.maxChunkLength,
      chunkOverlap: this.chunkOverlap,
    });
  }
}
