import { RetrievedChunk, RetrievalOptions, SourceReference } from "../shared/types";

export function filterRetrievedChunks(
  chunks: RetrievedChunk[],
  options: RetrievalOptions,
): RetrievedChunk[] {
  return chunks.filter((chunk) => chunkMatchesRetrievalOptions(chunk, options));
}

export function chunkMatchesRetrievalOptions(
  chunk: RetrievedChunk,
  options: RetrievalOptions,
): boolean {
  if (!options.includeWebResults && chunk.source.kind === "web") {
    return false;
  }

  if (options.minScore !== undefined && chunk.score < options.minScore) {
    return false;
  }

  if (options.sourceKinds && !options.sourceKinds.includes(chunk.source.kind)) {
    return false;
  }

  if (options.fileExtensions && options.fileExtensions.length > 0) {
    const extension = sourceExtension(chunk.source);

    if (
      !extension ||
      !options.fileExtensions.some((candidate) => normalizeExtension(candidate) === extension)
    ) {
      return false;
    }
  }

  if (options.sourcePaths && options.sourcePaths.length > 0) {
    const path = sourcePath(chunk.source);

    if (!path || !options.sourcePaths.includes(path)) {
      return false;
    }
  }

  return true;
}

function sourcePath(source: SourceReference): string | null {
  return source.kind === "web" ? null : source.path;
}

function sourceExtension(source: SourceReference): string | null {
  if (source.kind === "web") {
    return null;
  }

  const path = source.path;
  const index = path.lastIndexOf(".");

  if (index < 0 || index === path.length - 1) {
    return source.kind === "document" ? normalizeExtension(source.format) : null;
  }

  return normalizeExtension(path.slice(index + 1));
}

function normalizeExtension(value: string): string {
  return value.trim().replace(/^\./, "").toLowerCase();
}
