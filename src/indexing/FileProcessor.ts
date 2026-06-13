import type { ExtractedChunk } from "../shared/types";
import { hashFileData, shouldIndexFile, updateSnapshot } from "./changeDetection";
import { detectTextLanguages } from "./languageDetection";
import type {
  FileProcessorOptions,
  IndexedFileResult,
  IndexingPerformanceLogEvent,
  VaultFileSummary,
} from "./types";

const INTERNAL_EXCLUDE_GLOBS = [".ixplorer/**"];

export class FileProcessor {
  private readonly options: FileProcessorOptions;

  constructor(options: FileProcessorOptions) {
    this.options = options;
  }

  async process(file: VaultFileSummary): Promise<IndexedFileResult> {
    const extractor = this.options.extractors.find((candidate) => candidate.supports(file.path));

    if (!extractor) {
      this.options.logger?.logIndexingFile({
        path: file.path,
        outcome: "skipped",
        reason: "unsupported-file-type",
        modifiedTime: file.modifiedTime,
      });
      return { indexed: false, skipped: true, chunks: [] };
    }

    if (!this.shouldScanPath(file.path)) {
      this.options.logger?.logIndexingFile({
        path: file.path,
        outcome: "skipped",
        reason: "excluded-by-path",
        modifiedTime: file.modifiedTime,
        extractor: extractor.constructor.name,
      });
      return { indexed: false, skipped: true, chunks: [] };
    }

    if (!shouldIndexFile(this.options.snapshots, file)) {
      this.options.logger?.logIndexingFile({
        path: file.path,
        outcome: "skipped",
        reason: "unchanged-metadata",
        modifiedTime: file.modifiedTime,
        extractor: extractor.constructor.name,
      });
      return { indexed: false, skipped: true, chunks: [] };
    }

    this.options.progress.setPhase("extracting", file.path);
    const readStartedAt = Date.now();
    const data = await this.options.files.readFile(file.path);
    this.logPerformance({
      phase: "readFile",
      path: file.path,
      durationMs: Date.now() - readStartedAt,
    });
    const hashStartedAt = Date.now();
    const contentHash = hashFileData(data);
    this.logPerformance({
      phase: "hash",
      path: file.path,
      durationMs: Date.now() - hashStartedAt,
    });

    if (!shouldIndexFile(this.options.snapshots, { ...file, contentHash })) {
      updateSnapshot(this.options.snapshots, { ...file, contentHash });
      this.options.logger?.logIndexingFile({
        path: file.path,
        outcome: "skipped",
        reason: "unchanged-content",
        modifiedTime: file.modifiedTime,
        extractor: extractor.constructor.name,
        contentHash,
      });
      return { indexed: false, skipped: true, chunks: [] };
    }

    const extractionStartedAt = Date.now();
    const chunks = await extractor.extract({
      path: file.path,
      data,
      modifiedTime: file.modifiedTime,
    });
    this.logPerformance({
      phase: "extracting",
      path: file.path,
      durationMs: Date.now() - extractionStartedAt,
      chunkCount: chunks.length,
    });

    if (chunks.length === 0) {
      const languages = detectTextLanguages(String(data));
      this.options.logger?.logIndexingFile({
        path: file.path,
        outcome: "skipped",
        reason: "no-extractable-text",
        modifiedTime: file.modifiedTime,
        extractor: extractor.constructor.name,
        contentHash,
        chunkCount: 0,
      });

      return {
        indexed: false,
        skipped: true,
        chunks,
        contentHash,
        persistSnapshot: true,
        languages,
      };
    }

    return {
      indexed: true,
      skipped: false,
      chunks,
      contentHash,
      languages: detectTextLanguages(
        chunks.map((chunk: ExtractedChunk) => chunk.text).join("\n\n"),
      ),
    };
  }

  private shouldScanPath(path: string): boolean {
    return (
      isIncluded(path, this.options.includeFolders) &&
      !INTERNAL_EXCLUDE_GLOBS.some((glob) => globMatches(path, glob)) &&
      !this.options.excludeGlobs.some((glob) => globMatches(path, glob))
    );
  }

  private logPerformance(event: IndexingPerformanceLogEvent): void {
    this.options.logger?.logIndexingPerformance?.(event);
  }
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

function normalizeFolder(folder: string): string {
  const normalized = folder.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");

  return normalized === "." ? "" : normalized;
}

function globMatches(path: string, glob: string): boolean {
  const normalizedGlob = glob.replace(/\\/g, "/").replace(/^\/+/, "");

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
