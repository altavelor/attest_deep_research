import { IxplorerSettings } from "../settings/settings";
import { ExtractedChunk, Extractor, ExtractorInput } from "../shared/types";
import { chunkMarkdown } from "../indexing/chunker";

export interface MarkdownExtractorOptions {
  includeFolders?: string[];
  excludeGlobs?: string[];
  maxChunkLength?: number;
}

export class MarkdownExtractor implements Extractor {
  private readonly includeFolders: string[];
  private readonly excludeGlobs: string[];
  private readonly maxChunkLength?: number;

  constructor(options: MarkdownExtractorOptions = {}) {
    this.includeFolders = options.includeFolders ?? ["/"];
    this.excludeGlobs = options.excludeGlobs ?? [];
    this.maxChunkLength = options.maxChunkLength;
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
    const normalizedPath = normalizePath(path);

    return (
      isIncluded(normalizedPath, this.includeFolders) &&
      !this.excludeGlobs.some((glob) => globMatches(normalizedPath, glob))
    );
  }

  async extract(input: ExtractorInput): Promise<ExtractedChunk[]> {
    if (!this.supports(input.path)) {
      return [];
    }

    return chunkMarkdown({
      path: normalizePath(input.path),
      text: readText(input.data),
      maxChunkLength: this.maxChunkLength,
    });
  }
}

function readText(data: ArrayBuffer | string): string {
  return typeof data === "string" ? data : new TextDecoder().decode(data);
}

function isIncluded(path: string, includeFolders: string[]): boolean {
  return includeFolders.some((folder) => {
    const normalizedFolder = normalizeFolder(folder);

    return (
      normalizedFolder === "" ||
      path === normalizedFolder ||
      path.startsWith(`${normalizedFolder}/`)
    );
  });
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");
}

function normalizeFolder(folder: string): string {
  const normalized = normalizePath(folder.trim()).replace(/\/+$/, "");

  return normalized === "." ? "" : normalized;
}

function globMatches(path: string, glob: string): boolean {
  const normalizedGlob = normalizePath(glob.trim());

  if (!normalizedGlob) {
    return false;
  }

  return globToRegExp(normalizedGlob).test(path);
}

function globToRegExp(glob: string): RegExp {
  let pattern = "^";

  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    const nextCharacter = glob[index + 1];

    if (character === "*" && nextCharacter === "*") {
      pattern += ".*";
      index += 1;
    } else if (character === "*") {
      pattern += "[^/]*";
    } else {
      pattern += escapeRegExp(character);
    }
  }

  return new RegExp(`${pattern}$`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$+?.()|[\]{}]/g, "\\$&");
}
