import {
  FindInIndexOptions,
  IndexChunkListOptions,
  IndexChunkReadOptions,
  IndexMetadataSearchOptions,
  IndexSectionReadOptions,
  IndexSourceInventoryOptions,
} from "@application/ports";
import { ResearchRetriever } from "@application/contracts";
import { Tool } from "@core/agent";
import {
  FIND_IN_INDEX_TOOL,
  GET_INDEX_SOURCE_OUTLINE_TOOL,
  GET_SOURCE_METADATA_TOOL,
  LIST_SHARED_REFERENCES_TOOL,
  LIST_INDEX_CHUNKS_TOOL,
  LIST_INDEX_SOURCES_TOOL,
  READ_INDEX_CHUNK_TOOL,
  READ_INDEX_SECTION_TOOL,
  SEARCH_INDEX_BY_METADATA_TOOL,
  SUMMARIZE_INDEX_SOURCE_TOOL,
} from "@core/agent";
import { SourceKind } from "@core/model";
import {
  bool,
  defineInventoryTool,
  diagnostics,
  enumOf,
  int,
  okPage,
  str,
  strArray,
} from "@application/sources/tools";

const SOURCE_KINDS: SourceKind[] = ["markdown", "pdf", "document", "web"];
const MAX_CURSOR_CHARS = 200;
const MAX_PATH_CHARS = 500;
const MAX_QUERY_CHARS = 240;
const MAX_PATTERN_CHARS = 500;
const DEFAULT_LIST_LIMIT = 25;
const MAX_LIST_LIMIT = 100;
const DEFAULT_CHUNK_LIMIT = 20;
const MAX_CHUNK_LIMIT = 50;
const DEFAULT_MAX_CHARS = 12_000;
const MAX_READ_CHARS = 40_000;
const MAX_NEIGHBORS = 10;
const DEFAULT_MAX_SECTIONS = 40;
const MAX_SECTIONS = 200;

export const ListIndexSourcesTool = defineInventoryTool<IndexSourceInventoryOptions>({
  name: LIST_INDEX_SOURCES_TOOL,
  description:
    "List documents, books, and files available in the selected local index. Use before narrowing work to a specific source.",
  schema: {
    cursor: str(MAX_CURSOR_CHARS),
    limit: int(1, MAX_LIST_LIMIT, DEFAULT_LIST_LIMIT),
    kind: enumOf(SOURCE_KINDS),
    pathPrefix: str(MAX_PATH_CHARS),
    query: str(MAX_QUERY_CHARS),
  },
  capability: "listIndexSources",
  errorCode: "index-source-list-failed",
  errorMessage: "Index source listing failed.",
  run: (retriever, input) => retriever.listIndexSources!(input),
  wrap: (result, input) => okPage(result as { items: unknown[] }, input.limit),
});

export const ListIndexChunksTool = defineInventoryTool<IndexChunkListOptions>({
  name: LIST_INDEX_CHUNKS_TOOL,
  description:
    "Read chunks from one indexed source in document order, not semantic relevance order. Use for exhaustive passes through a book or file.",
  schema: {
    sourcePath: str(MAX_PATH_CHARS, { required: true }),
    cursor: str(MAX_CURSOR_CHARS),
    limit: int(1, MAX_CHUNK_LIMIT, DEFAULT_CHUNK_LIMIT),
    headingPath: strArray(12, 160),
  },
  capability: "listIndexChunks",
  errorCode: "index-chunk-list-failed",
  errorMessage: "Index chunk listing failed.",
  run: (retriever, input) => retriever.listIndexChunks!(input),
  wrap: (result, input) => okPage(result as { items: unknown[] }, input.limit),
});

export const ReadIndexChunkTool = defineInventoryTool<IndexChunkReadOptions>({
  name: READ_INDEX_CHUNK_TOOL,
  description:
    "Read the full text of one indexed chunk plus bounded neighboring chunks for exact context checks.",
  schema: {
    chunkId: str(240, { required: true }),
    before: int(0, MAX_NEIGHBORS, 0),
    after: int(0, MAX_NEIGHBORS, 0),
    maxChars: int(1, MAX_READ_CHARS, DEFAULT_MAX_CHARS),
  },
  capability: "readIndexChunk",
  errorCode: "index-chunk-read-failed",
  errorMessage: "Index chunk read failed.",
  run: (retriever, input) => retriever.readIndexChunk!(input),
  wrap: (result, input) => {
    const value = result as { chunks: unknown[] };
    return { ...value, diagnostics: diagnostics(value.chunks.length, input.maxChars) };
  },
});

const DEFAULT_SECTION_CHARS = 20_000;
const MAX_SECTION_CHARS = 60_000;

export const ReadIndexSectionTool = defineInventoryTool<IndexSectionReadOptions>({
  name: READ_INDEX_SECTION_TOOL,
  description:
    "Read the entire section a chunk belongs to (same heading), in document order. Use when a search hit looks like a heading or a fragment of a larger passage — one call instead of guessing neighbor chunks.",
  schema: {
    chunkId: str(240, { required: true }),
    maxChars: int(1, MAX_SECTION_CHARS, DEFAULT_SECTION_CHARS),
    cursor: str(MAX_CURSOR_CHARS, {
      description: "Continuation cursor from a previous read of the same section.",
    }),
  },
  capability: "readIndexSection",
  errorCode: "index-section-read-failed",
  errorMessage: "Index section read failed.",
  run: (retriever, input) => retriever.readIndexSection!(input),
  wrap: (result, input) => {
    const section = result as { chunks: unknown[] } | null;
    return {
      section,
      diagnostics: diagnostics(section?.chunks.length ?? 0, input.maxChars),
    };
  },
});

export const FindInIndexTool = defineInventoryTool<FindInIndexOptions>({
  name: FIND_IN_INDEX_TOOL,
  description:
    "Find exact literal or regex matches in indexed text without semantic search. Use for URLs, ISBNs, DOIs, dates, TODOs, links, and exact terms.",
  schema: {
    pattern: str(MAX_PATTERN_CHARS, { required: true }),
    mode: enumOf(["literal", "regex"], { required: true }),
    sourcePath: str(MAX_PATH_CHARS),
    caseSensitive: bool(),
    cursor: str(MAX_CURSOR_CHARS),
    limit: int(1, MAX_LIST_LIMIT, DEFAULT_LIST_LIMIT),
    countOnly: bool({ description: "Return only the total match count, not the matches." }),
  },
  capability: "findInIndex",
  errorCode: "find-in-index-failed",
  errorMessage: "Index text search failed.",
  run: (retriever, input) => retriever.findInIndex!(input),
  wrap: (result, input) => pageOrCount(result, input),
});

export const SummarizeIndexSourceTool = defineInventoryTool<{
  sourcePath: string;
  maxSections: number;
}>({
  name: SUMMARIZE_INDEX_SOURCE_TOOL,
  description:
    "Return a structural map of an indexed source: headings, approximate size, chunk ranges, and frequent topics.",
  schema: {
    sourcePath: str(MAX_PATH_CHARS, { required: true }),
    maxSections: int(1, MAX_SECTIONS, DEFAULT_MAX_SECTIONS),
  },
  capability: "summarizeIndexSource",
  errorCode: "index-source-summary-failed",
  errorMessage: "Index source summary failed.",
  run: (retriever, input) => retriever.summarizeIndexSource!(input.sourcePath, input.maxSections),
  wrap: (summary, input) => ({
    summary,
    diagnostics: diagnostics(summary ? 1 : 0, input.maxSections),
  }),
});

export const GetIndexSourceOutlineTool = defineInventoryTool<{ sourcePath: string }>({
  name: GET_INDEX_SOURCE_OUTLINE_TOOL,
  description: "Return only the heading hierarchy and chunk ranges for one indexed source.",
  schema: {
    sourcePath: str(MAX_PATH_CHARS, { required: true }),
  },
  capability: "getIndexSourceOutline",
  errorCode: "index-source-outline-failed",
  errorMessage: "Index source outline failed.",
  run: (retriever, input) => retriever.getIndexSourceOutline!(input.sourcePath),
  wrap: (outline) => ({ outline, diagnostics: diagnostics(outline ? 1 : 0, 1) }),
});

export const SearchIndexByMetadataTool = defineInventoryTool<IndexMetadataSearchOptions>({
  name: SEARCH_INDEX_BY_METADATA_TOOL,
  description:
    "Search indexed sources by metadata before semantic search: kind, path prefix, extension, title, heading, indexed date, or language.",
  schema: {
    sourceKind: enumOf(SOURCE_KINDS),
    pathPrefix: str(MAX_PATH_CHARS),
    extension: str(20),
    title: str(MAX_QUERY_CHARS),
    heading: str(MAX_QUERY_CHARS),
    indexedAfter: str(40),
    language: str(40),
    cursor: str(MAX_CURSOR_CHARS),
    limit: int(1, MAX_LIST_LIMIT, DEFAULT_LIST_LIMIT),
    countOnly: bool({ description: "Return only the total count of matched sources, not the sources." }),
  },
  capability: "searchIndexByMetadata",
  errorCode: "index-metadata-search-failed",
  errorMessage: "Index metadata search failed.",
  run: (retriever, input) => retriever.searchIndexByMetadata!(input),
  wrap: (result, input) => pageOrCount(result, input),
});

export const GetSourceMetadataTool = defineInventoryTool<{ sourcePath: string }>({
  name: GET_SOURCE_METADATA_TOOL,
  description:
    "Return extracted bibliographic metadata for one indexed source: title, authors, year, abstract, and its list of references. Available only after index enrichment has run.",
  schema: {
    sourcePath: str(MAX_PATH_CHARS, { required: true }),
  },
  capability: "getSourceMetadata",
  errorCode: "source-metadata-failed",
  errorMessage: "Source metadata lookup failed.",
  run: (retriever, input) => retriever.getSourceMetadata!(input.sourcePath),
  wrap: (metadata) => ({ metadata, diagnostics: diagnostics(metadata ? 1 : 0, 1) }),
});

const DEFAULT_MIN_SHARED_SOURCES = 2;
const MAX_MIN_SHARED_SOURCES = 50;

export const ListSharedReferencesTool = defineInventoryTool<{ minSources: number }>({
  name: LIST_SHARED_REFERENCES_TOOL,
  description:
    "List works cited by several indexed documents (shared bibliography). Use to find common sources across articles. Available only after index enrichment has run.",
  schema: {
    minSources: int(2, MAX_MIN_SHARED_SOURCES, DEFAULT_MIN_SHARED_SOURCES, {
      description: "Minimum number of citing documents.",
    }),
  },
  capability: "listSharedReferences",
  errorCode: "shared-references-failed",
  errorMessage: "Shared references lookup failed.",
  run: (retriever, input) => retriever.listSharedReferences!(input),
  wrap: (result, input) => {
    const items = result as unknown[];
    return { items, diagnostics: diagnostics(items.length, input.minSources) };
  },
});

/** Page result, or — when the caller asked for `countOnly` — just the total match count. */
function pageOrCount(
  result: unknown,
  input: { limit: number; countOnly?: boolean },
): unknown {
  const page = result as { items: unknown[]; totalCount?: number };
  if (input.countOnly) {
    const count = page.totalCount ?? page.items.length;
    return { count, diagnostics: diagnostics(count, input.limit) };
  }
  return okPage(page, input.limit);
}

/** Registry of retriever-backed index inventory tools; the single source of truth. */
export const INDEX_INVENTORY_TOOLS: ReadonlyArray<
  new (retriever: ResearchRetriever) => Tool
> = [
  ListIndexSourcesTool,
  ListIndexChunksTool,
  ReadIndexChunkTool,
  ReadIndexSectionTool,
  FindInIndexTool,
  SummarizeIndexSourceTool,
  GetIndexSourceOutlineTool,
  SearchIndexByMetadataTool,
  GetSourceMetadataTool,
  ListSharedReferencesTool,
];
