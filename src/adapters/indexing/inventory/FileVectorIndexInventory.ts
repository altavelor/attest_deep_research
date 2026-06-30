import {
  FindInIndexMatch,
  FindInIndexOptions,
  IndexChunkListItem,
  IndexChunkListOptions,
  IndexChunkReadOptions,
  IndexChunkReadResult,
  IndexCursorPage,
  IndexMetadataSearchOptions,
  IndexSectionOutline,
  IndexSourceInventoryItem,
  IndexSourceInventoryOptions,
  IndexSourceOutline,
  IndexSourceSummary,
} from "../../../application/ports/retrieval";
import { SourceReference } from "../../../core/model/source";
import type { FileVectorIndexState, StoredChunk } from "../store/FileVectorIndexState";
import {
  createIndexMatcher,
  frequentTerms,
  matchesInChunk,
} from "./FileVectorIndexInventoryText";
import { sourcePathFromReference } from "../store/FileVectorIndexVector";

export function listFileVectorIndexSources(
  state: FileVectorIndexState,
  options: IndexSourceInventoryOptions,
): IndexCursorPage<IndexSourceInventoryItem> {
  const start = parseCursor(options.cursor);
  const sources = sourceInventoryItems(state)
    .filter((source) => sourceMatchesInventoryOptions(source, options))
    .sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));

  return pageItems(sources, start, options.limit);
}

export function listFileVectorIndexChunks(
  state: FileVectorIndexState,
  options: IndexChunkListOptions,
): IndexCursorPage<IndexChunkListItem> {
  if (options.limit <= 0) {
    return { items: [] };
  }

  const start = parseCursor(options.cursor);
  const chunks = storedChunksForSource(state, options.sourcePath)
    .filter((chunk) => headingMatches(chunk.row.source, options.headingPath))
    .map(toChunkListItem);

  return pageItems(chunks, start, options.limit);
}

export function readFileVectorIndexChunk(
  state: FileVectorIndexState,
  options: IndexChunkReadOptions,
): IndexChunkReadResult {
  if (options.before < 0 || options.after < 0 || options.maxChars <= 0) {
    return { chunks: [] };
  }

  const hit = storedChunksById(state).get(options.chunkId);
  if (!hit) {
    return { chunks: [] };
  }

  const sourcePath = hit.row.sourcePath ?? sourcePathFromReference(hit.row.source);
  const chunks = storedChunksForSource(state, sourcePath);
  const index = chunks.findIndex((chunk) => chunk.row.id === options.chunkId);
  if (index === -1) {
    return { chunks: [] };
  }

  const start = Math.max(0, index - options.before);
  const end = Math.min(chunks.length, index + options.after + 1);
  const selectedChunks = chunks.slice(start, end);
  const textByChunkId = new Map<string, string>();
  const targetText = hit.row.text.slice(0, options.maxChars);
  textByChunkId.set(hit.row.id, targetText);
  let remaining = options.maxChars - targetText.length;

  for (const chunk of selectedChunks) {
    if (chunk.row.id === hit.row.id || remaining <= 0) {
      continue;
    }
    const text = chunk.row.text.slice(0, remaining);
    if (text.length === 0) {
      continue;
    }
    textByChunkId.set(chunk.row.id, text);
    remaining -= text.length;
  }

  const selected = [];
  for (const chunk of selectedChunks) {
    const text = textByChunkId.get(chunk.row.id);
    if (text === undefined) {
      continue;
    }
    selected.push({
      chunkId: chunk.row.id,
      sourcePath,
      chunkIndex: chunk.row.chunkIndex ?? 0,
      text,
      charCount: chunk.row.text.length,
      truncated: text.length < chunk.row.text.length,
      source: chunk.row.source,
    });
  }

  return { chunks: selected };
}

export function findInFileVectorIndex(
  state: FileVectorIndexState,
  options: FindInIndexOptions,
): IndexCursorPage<FindInIndexMatch> {
  if (options.limit <= 0 || options.pattern.length === 0) {
    return { items: [] };
  }

  const matcher = createIndexMatcher(options);
  if (!matcher) {
    return { items: [] };
  }

  const matches: FindInIndexMatch[] = [];
  for (const chunk of sortedStoredChunks(state)) {
    const sourcePath = chunk.row.sourcePath ?? sourcePathFromReference(chunk.row.source);
    if (options.sourcePath && sourcePath !== options.sourcePath) {
      continue;
    }
    matches.push(...matchesInChunk(chunk, sourcePath, matcher));
  }

  return pageItems(matches, parseCursor(options.cursor), options.limit);
}

export function summarizeFileVectorIndexSource(
  state: FileVectorIndexState,
  sourcePath: string,
  maxSections: number,
): IndexSourceSummary | null {
  const outline = getFileVectorIndexSourceOutline(state, sourcePath);
  if (!outline) {
    return null;
  }

  return {
    ...outline,
    sections: outline.sections.slice(0, Math.max(0, maxSections)),
    topics: frequentTerms(storedChunksForSource(state, sourcePath).map((chunk) => chunk.row.text)),
  };
}

export function getFileVectorIndexSourceOutline(
  state: FileVectorIndexState,
  sourcePath: string,
): IndexSourceOutline | null {
  const chunks = storedChunksForSource(state, sourcePath);
  if (chunks.length === 0) {
    return null;
  }

  const first = chunks[0].row;
  return {
    sourcePath,
    title: first.source.title,
    kind: first.source.kind,
    chunkCount: chunks.length,
    charCount: chunks.reduce((total, chunk) => total + chunk.row.text.length, 0),
    sections: outlineSections(chunks),
  };
}

export function searchFileVectorIndexByMetadata(
  state: FileVectorIndexState,
  options: IndexMetadataSearchOptions,
): IndexCursorPage<IndexSourceInventoryItem> {
  const sources = sourceInventoryItems(state)
    .filter((source) => metadataMatchesSource(source, options))
    .filter((source) => headingMetadataMatches(state, source, options.heading))
    .sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));

  return pageItems(sources, parseCursor(options.cursor), options.limit);
}

function sortedStoredChunks(state: FileVectorIndexState): StoredChunk[] {
  return [...state.chunksByShard.values()]
    .flat()
    .sort((left, right) => {
      const leftPath = left.row.sourcePath ?? sourcePathFromReference(left.row.source);
      const rightPath = right.row.sourcePath ?? sourcePathFromReference(right.row.source);
      return (
        leftPath.localeCompare(rightPath) ||
        (left.row.chunkIndex ?? 0) - (right.row.chunkIndex ?? 0) ||
        left.row.id.localeCompare(right.row.id)
      );
    });
}

function storedChunksForSource(
  state: FileVectorIndexState,
  sourcePath: string,
): StoredChunk[] {
  return sortedStoredChunks(state).filter((chunk) => {
    const chunkSourcePath = chunk.row.sourcePath ?? sourcePathFromReference(chunk.row.source);
    return chunkSourcePath === sourcePath;
  });
}

function storedChunksById(state: FileVectorIndexState): Map<string, StoredChunk> {
  return new Map(sortedStoredChunks(state).map((chunk) => [chunk.row.id, chunk]));
}

function sourceInventoryItems(state: FileVectorIndexState): IndexSourceInventoryItem[] {
  const firstChunkByPath = new Map<string, StoredChunk>();
  for (const chunk of sortedStoredChunks(state)) {
    const sourcePath = chunk.row.sourcePath ?? sourcePathFromReference(chunk.row.source);
    if (!firstChunkByPath.has(sourcePath)) {
      firstChunkByPath.set(sourcePath, chunk);
    }
  }

  return state.sources
    .filter((source) => source.failed !== true)
    .map((source) => {
      const firstChunk = firstChunkByPath.get(source.sourcePath);
      return {
        sourcePath: source.sourcePath,
        title: firstChunk?.row.source.title ?? source.sourcePath,
        kind: firstChunk?.row.source.kind ?? "document",
        modifiedTime: source.modifiedTime,
        indexedAt: source.indexedAt,
        chunkCount: source.chunkCount,
        ...(source.languages ? { languages: source.languages } : {}),
      };
    });
}

function sourceMatchesInventoryOptions(
  source: IndexSourceInventoryItem,
  options: IndexSourceInventoryOptions,
): boolean {
  return (
    (!options.kind || source.kind === options.kind) &&
    (!options.pathPrefix || source.sourcePath.startsWith(options.pathPrefix)) &&
    (!options.query || sourceText(source).includes(options.query.toLocaleLowerCase()))
  );
}

function metadataMatchesSource(
  source: IndexSourceInventoryItem,
  options: IndexMetadataSearchOptions,
): boolean {
  const extension = options.extension?.toLocaleLowerCase().replace(/^\./, "");
  return (
    (!options.sourceKind || source.kind === options.sourceKind) &&
    (!options.pathPrefix || source.sourcePath.startsWith(options.pathPrefix)) &&
    (!extension || source.sourcePath.toLocaleLowerCase().endsWith(`.${extension}`)) &&
    (!options.title ||
      source.title.toLocaleLowerCase().includes(options.title.toLocaleLowerCase())) &&
    (!options.indexedAfter || source.indexedAt > options.indexedAfter) &&
    (!options.language || source.languages?.includes(options.language) === true)
  );
}

function headingMetadataMatches(
  state: FileVectorIndexState,
  source: IndexSourceInventoryItem,
  heading: string | undefined,
): boolean {
  if (!heading) {
    return true;
  }
  const query = heading.toLocaleLowerCase();
  return storedChunksForSource(state, source.sourcePath).some(
    (chunk) =>
      chunk.row.source.kind === "markdown" &&
      chunk.row.source.headingPath.some((item) => item.toLocaleLowerCase().includes(query)),
  );
}

function sourceText(source: IndexSourceInventoryItem): string {
  return `${source.sourcePath} ${source.title}`.toLocaleLowerCase();
}

function headingMatches(source: SourceReference, headingPath: string[] | undefined): boolean {
  if (!headingPath || headingPath.length === 0) {
    return true;
  }
  if (source.kind !== "markdown") {
    return false;
  }
  return headingPath.every((heading, index) => source.headingPath[index] === heading);
}

function toChunkListItem(chunk: StoredChunk): IndexChunkListItem {
  const sourcePath = chunk.row.sourcePath ?? sourcePathFromReference(chunk.row.source);
  return {
    chunkId: chunk.row.id,
    sourcePath,
    chunkIndex: chunk.row.chunkIndex ?? 0,
    title: chunk.row.source.title,
    ...(chunk.row.source.kind === "markdown" ? { headingPath: chunk.row.source.headingPath } : {}),
    textPreview: chunk.row.text.slice(0, 500),
    charCount: chunk.row.text.length,
    source: chunk.row.source,
  };
}

function outlineSections(chunks: StoredChunk[]): IndexSectionOutline[] {
  const sections = new Map<string, IndexSectionOutline>();
  chunks.forEach((chunk) => {
    const headingPath = chunk.row.source.kind === "markdown" ? chunk.row.source.headingPath : [];
    const key = headingPath.join("\u0000");
    const existing = sections.get(key);
    const chunkIndex = chunk.row.chunkIndex ?? 0;
    if (existing) {
      existing.chunkEnd = chunkIndex;
      existing.chunkCount += 1;
      existing.charCount += chunk.row.text.length;
      return;
    }
    sections.set(key, {
      headingPath,
      title: headingPath.at(-1) ?? chunk.row.source.title,
      level: headingPath.length,
      chunkStart: chunkIndex,
      chunkEnd: chunkIndex,
      chunkCount: 1,
      charCount: chunk.row.text.length,
    });
  });
  return Array.from(sections.values()).sort((left, right) => left.chunkStart - right.chunkStart);
}

function pageItems<T>(items: T[], start: number, limit: number): IndexCursorPage<T> {
  if (limit <= 0) {
    return { items: [] };
  }
  const selected = items.slice(start, start + limit);
  const next = start + selected.length;
  return {
    items: selected,
    ...(next < items.length ? { nextCursor: String(next) } : {}),
  };
}

function parseCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const parsed = Number.parseInt(cursor, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
