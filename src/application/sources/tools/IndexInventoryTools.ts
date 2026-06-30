import {
  FindInIndexOptions,
  IndexChunkListOptions,
  IndexChunkReadOptions,
  IndexMetadataSearchOptions,
  IndexSourceInventoryOptions,
} from "../../ports/retrieval";
import { ResearchRetriever } from "../../contracts/research";
import {
  Tool as ResearchToolHandler,
  ToolExecution as ResearchToolExecution,
  ToolParseResult as ResearchToolParseResult,
  toolFailure,
} from "../../../core/agent/tool";
import { SourceKind } from "../../../core/model/source";

type InventoryInput = Record<string, unknown>;

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

export class ListIndexSourcesTool implements ResearchToolHandler<IndexSourceInventoryOptions, unknown> {
  readonly definition = toolDefinition("list_index_sources", "List documents, books, and files available in the selected local index. Use before narrowing work to a specific source.", {
    cursor: { type: "string", maxLength: MAX_CURSOR_CHARS },
    limit: { type: "integer", minimum: 1, maximum: MAX_LIST_LIMIT },
    kind: { type: "string", enum: SOURCE_KINDS },
    pathPrefix: { type: "string", maxLength: MAX_PATH_CHARS },
    query: { type: "string", maxLength: MAX_QUERY_CHARS },
  });

  constructor(private readonly retriever: ResearchRetriever) {}

  parseInput(input: InventoryInput): ResearchToolParseResult<IndexSourceInventoryOptions> {
    const base = parseSourceFilters(input, ["cursor", "limit", "kind", "pathPrefix", "query"]);
    if (!base.ok) return base;
    return { ok: true, value: { ...base.value, limit: readLimit(input.limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT) } };
  }

  async execute(input: IndexSourceInventoryOptions): Promise<ResearchToolExecution<unknown>> {
    if (!this.retriever.listIndexSources) return unsupported("list_index_sources");
    try {
      const result = await this.retriever.listIndexSources(input);
      return okPage(result, input.limit);
    } catch {
      return toolFailure("index-source-list-failed", "Index source listing failed.", true);
    }
  }
}

export class ListIndexChunksTool implements ResearchToolHandler<IndexChunkListOptions, unknown> {
  readonly definition = toolDefinition("list_index_chunks", "Read chunks from one indexed source in document order, not semantic relevance order. Use for exhaustive passes through a book or file.", {
    sourcePath: { type: "string", maxLength: MAX_PATH_CHARS },
    cursor: { type: "string", maxLength: MAX_CURSOR_CHARS },
    limit: { type: "integer", minimum: 1, maximum: MAX_CHUNK_LIMIT },
    headingPath: { type: "array", items: { type: "string", maxLength: 160 }, maxItems: 12 },
  }, ["sourcePath"]);

  constructor(private readonly retriever: ResearchRetriever) {}

  parseInput(input: InventoryInput): ResearchToolParseResult<IndexChunkListOptions> {
    const unknown = unknownProperty(input, ["sourcePath", "cursor", "limit", "headingPath"]);
    if (unknown) return toolFailure("unknown-property", `Unknown property: ${unknown}.`);
    const sourcePath = readString(input.sourcePath, MAX_PATH_CHARS);
    if (!sourcePath) return toolFailure("invalid-source-path", "sourcePath is required.");
    const cursor = readOptionalString(input.cursor, MAX_CURSOR_CHARS);
    if (cursor === false) return toolFailure("invalid-cursor", "Cursor must be a bounded string.");
    const headingPath = readStringArray(input.headingPath);
    if (headingPath === false) return toolFailure("invalid-heading-path", "headingPath must be an array of strings.");
    return {
      ok: true,
      value: {
        sourcePath,
        ...(cursor ? { cursor } : {}),
        limit: readLimit(input.limit, DEFAULT_CHUNK_LIMIT, MAX_CHUNK_LIMIT),
        ...(headingPath ? { headingPath } : {}),
      },
    };
  }

  async execute(input: IndexChunkListOptions): Promise<ResearchToolExecution<unknown>> {
    if (!this.retriever.listIndexChunks) return unsupported("list_index_chunks");
    try {
      const result = await this.retriever.listIndexChunks(input);
      return okPage(result, input.limit);
    } catch {
      return toolFailure("index-chunk-list-failed", "Index chunk listing failed.", true);
    }
  }
}

export class ReadIndexChunkTool implements ResearchToolHandler<IndexChunkReadOptions, unknown> {
  readonly definition = toolDefinition("read_index_chunk", "Read the full text of one indexed chunk plus bounded neighboring chunks for exact context checks.", {
    chunkId: { type: "string", maxLength: 240 },
    before: { type: "integer", minimum: 0, maximum: MAX_NEIGHBORS },
    after: { type: "integer", minimum: 0, maximum: MAX_NEIGHBORS },
    maxChars: { type: "integer", minimum: 1, maximum: MAX_READ_CHARS },
  }, ["chunkId"]);

  constructor(private readonly retriever: ResearchRetriever) {}

  parseInput(input: InventoryInput): ResearchToolParseResult<IndexChunkReadOptions> {
    const unknown = unknownProperty(input, ["chunkId", "before", "after", "maxChars"]);
    if (unknown) return toolFailure("unknown-property", `Unknown property: ${unknown}.`);
    const chunkId = readString(input.chunkId, 240);
    if (!chunkId) return toolFailure("invalid-chunk-id", "chunkId is required.");
    return {
      ok: true,
      value: {
        chunkId,
        before: readLimit(input.before, 0, MAX_NEIGHBORS, 0),
        after: readLimit(input.after, 0, MAX_NEIGHBORS, 0),
        maxChars: readLimit(input.maxChars, DEFAULT_MAX_CHARS, MAX_READ_CHARS),
      },
    };
  }

  async execute(input: IndexChunkReadOptions): Promise<ResearchToolExecution<unknown>> {
    if (!this.retriever.readIndexChunk) return unsupported("read_index_chunk");
    try {
      const result = await this.retriever.readIndexChunk(input);
      return { ok: true, value: { ...result, diagnostics: diagnostics(result.chunks.length, input.maxChars) } };
    } catch {
      return toolFailure("index-chunk-read-failed", "Index chunk read failed.", true);
    }
  }
}

export class FindInIndexTool implements ResearchToolHandler<FindInIndexOptions, unknown> {
  readonly definition = toolDefinition("find_in_index", "Find exact literal or regex matches in indexed text without semantic search. Use for URLs, ISBNs, DOIs, dates, TODOs, links, and exact terms.", {
    pattern: { type: "string", maxLength: MAX_PATTERN_CHARS },
    mode: { type: "string", enum: ["literal", "regex"] },
    sourcePath: { type: "string", maxLength: MAX_PATH_CHARS },
    caseSensitive: { type: "boolean" },
    cursor: { type: "string", maxLength: MAX_CURSOR_CHARS },
    limit: { type: "integer", minimum: 1, maximum: MAX_LIST_LIMIT },
  }, ["pattern", "mode"]);

  constructor(private readonly retriever: ResearchRetriever) {}

  parseInput(input: InventoryInput): ResearchToolParseResult<FindInIndexOptions> {
    const unknown = unknownProperty(input, ["pattern", "mode", "sourcePath", "caseSensitive", "cursor", "limit"]);
    if (unknown) return toolFailure("unknown-property", `Unknown property: ${unknown}.`);
    const pattern = readString(input.pattern, MAX_PATTERN_CHARS);
    if (!pattern) return toolFailure("invalid-pattern", "pattern is required.");
    if (input.mode !== "literal" && input.mode !== "regex") return toolFailure("invalid-mode", "mode must be literal or regex.");
    const sourcePath = readOptionalString(input.sourcePath, MAX_PATH_CHARS);
    const cursor = readOptionalString(input.cursor, MAX_CURSOR_CHARS);
    if (sourcePath === false || cursor === false) return toolFailure("invalid-string", "Optional strings must be bounded.");
    return {
      ok: true,
      value: {
        pattern,
        mode: input.mode,
        ...(sourcePath ? { sourcePath } : {}),
        ...(typeof input.caseSensitive === "boolean" ? { caseSensitive: input.caseSensitive } : {}),
        ...(cursor ? { cursor } : {}),
        limit: readLimit(input.limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT),
      },
    };
  }

  async execute(input: FindInIndexOptions): Promise<ResearchToolExecution<unknown>> {
    if (!this.retriever.findInIndex) return unsupported("find_in_index");
    try {
      const result = await this.retriever.findInIndex(input);
      return okPage(result, input.limit);
    } catch {
      return toolFailure("find-in-index-failed", "Index text search failed.", true);
    }
  }
}

export class SummarizeIndexSourceTool implements ResearchToolHandler<{ sourcePath: string; maxSections: number }, unknown> {
  readonly definition = toolDefinition("summarize_index_source", "Return a structural map of an indexed source: headings, approximate size, chunk ranges, and frequent topics.", {
    sourcePath: { type: "string", maxLength: MAX_PATH_CHARS },
    maxSections: { type: "integer", minimum: 1, maximum: MAX_SECTIONS },
  }, ["sourcePath"]);

  constructor(private readonly retriever: ResearchRetriever) {}

  parseInput(input: InventoryInput): ResearchToolParseResult<{ sourcePath: string; maxSections: number }> {
    const unknown = unknownProperty(input, ["sourcePath", "maxSections"]);
    if (unknown) return toolFailure("unknown-property", `Unknown property: ${unknown}.`);
    const sourcePath = readString(input.sourcePath, MAX_PATH_CHARS);
    if (!sourcePath) return toolFailure("invalid-source-path", "sourcePath is required.");
    return { ok: true, value: { sourcePath, maxSections: readLimit(input.maxSections, DEFAULT_MAX_SECTIONS, MAX_SECTIONS) } };
  }

  async execute(input: { sourcePath: string; maxSections: number }): Promise<ResearchToolExecution<unknown>> {
    if (!this.retriever.summarizeIndexSource) return unsupported("summarize_index_source");
    try {
      const summary = await this.retriever.summarizeIndexSource(input.sourcePath, input.maxSections);
      return { ok: true, value: { summary, diagnostics: diagnostics(summary ? 1 : 0, input.maxSections) } };
    } catch {
      return toolFailure("index-source-summary-failed", "Index source summary failed.", true);
    }
  }
}

export class GetIndexSourceOutlineTool implements ResearchToolHandler<{ sourcePath: string }, unknown> {
  readonly definition = toolDefinition("get_index_source_outline", "Return only the heading hierarchy and chunk ranges for one indexed source.", {
    sourcePath: { type: "string", maxLength: MAX_PATH_CHARS },
  }, ["sourcePath"]);

  constructor(private readonly retriever: ResearchRetriever) {}

  parseInput(input: InventoryInput): ResearchToolParseResult<{ sourcePath: string }> {
    const unknown = unknownProperty(input, ["sourcePath"]);
    if (unknown) return toolFailure("unknown-property", `Unknown property: ${unknown}.`);
    const sourcePath = readString(input.sourcePath, MAX_PATH_CHARS);
    return sourcePath ? { ok: true, value: { sourcePath } } : toolFailure("invalid-source-path", "sourcePath is required.");
  }

  async execute(input: { sourcePath: string }): Promise<ResearchToolExecution<unknown>> {
    if (!this.retriever.getIndexSourceOutline) return unsupported("get_index_source_outline");
    try {
      const outline = await this.retriever.getIndexSourceOutline(input.sourcePath);
      return { ok: true, value: { outline, diagnostics: diagnostics(outline ? 1 : 0, 1) } };
    } catch {
      return toolFailure("index-source-outline-failed", "Index source outline failed.", true);
    }
  }
}

export class SearchIndexByMetadataTool implements ResearchToolHandler<IndexMetadataSearchOptions, unknown> {
  readonly definition = toolDefinition("search_index_by_metadata", "Search indexed sources by metadata before semantic search: kind, path prefix, extension, title, heading, indexed date, or language.", {
    sourceKind: { type: "string", enum: SOURCE_KINDS },
    pathPrefix: { type: "string", maxLength: MAX_PATH_CHARS },
    extension: { type: "string", maxLength: 20 },
    title: { type: "string", maxLength: MAX_QUERY_CHARS },
    heading: { type: "string", maxLength: MAX_QUERY_CHARS },
    indexedAfter: { type: "string", maxLength: 40 },
    language: { type: "string", maxLength: 40 },
    cursor: { type: "string", maxLength: MAX_CURSOR_CHARS },
    limit: { type: "integer", minimum: 1, maximum: MAX_LIST_LIMIT },
  });

  constructor(private readonly retriever: ResearchRetriever) {}

  parseInput(input: InventoryInput): ResearchToolParseResult<IndexMetadataSearchOptions> {
    const unknown = unknownProperty(input, ["sourceKind", "pathPrefix", "extension", "title", "heading", "indexedAfter", "language", "cursor", "limit"]);
    if (unknown) return toolFailure("unknown-property", `Unknown property: ${unknown}.`);
    const sourceKind = typeof input.sourceKind === "string" && SOURCE_KINDS.includes(input.sourceKind as SourceKind) ? input.sourceKind as SourceKind : undefined;
    return {
      ok: true,
      value: compact({
        sourceKind,
        pathPrefix: optionalStringValue(input.pathPrefix, MAX_PATH_CHARS),
        extension: optionalStringValue(input.extension, 20),
        title: optionalStringValue(input.title, MAX_QUERY_CHARS),
        heading: optionalStringValue(input.heading, MAX_QUERY_CHARS),
        indexedAfter: optionalStringValue(input.indexedAfter, 40),
        language: optionalStringValue(input.language, 40),
        cursor: optionalStringValue(input.cursor, MAX_CURSOR_CHARS),
        limit: readLimit(input.limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT),
      }),
    };
  }

  async execute(input: IndexMetadataSearchOptions): Promise<ResearchToolExecution<unknown>> {
    if (!this.retriever.searchIndexByMetadata) return unsupported("search_index_by_metadata");
    try {
      const result = await this.retriever.searchIndexByMetadata(input);
      return okPage(result, input.limit);
    } catch {
      return toolFailure("index-metadata-search-failed", "Index metadata search failed.", true);
    }
  }
}

function parseSourceFilters(input: InventoryInput, allowed: string[]): ResearchToolParseResult<Omit<IndexSourceInventoryOptions, "limit">> {
  const unknown = unknownProperty(input, allowed);
  if (unknown) return toolFailure("unknown-property", `Unknown property: ${unknown}.`);
  const kind = typeof input.kind === "string" && SOURCE_KINDS.includes(input.kind as SourceKind) ? input.kind as SourceKind : undefined;
  return {
    ok: true,
    value: compact({
      cursor: optionalStringValue(input.cursor, MAX_CURSOR_CHARS),
      kind,
      pathPrefix: optionalStringValue(input.pathPrefix, MAX_PATH_CHARS),
      query: optionalStringValue(input.query, MAX_QUERY_CHARS),
    }),
  };
}

function toolDefinition(name: string, description: string, properties: Record<string, unknown>, required: string[] = []) {
  return { type: "function" as const, function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } } };
}

function okPage<T>(result: { items: T[]; nextCursor?: string }, limit: number): ResearchToolExecution<unknown> {
  return { ok: true, value: { ...result, diagnostics: diagnostics(result.items.length, limit) } };
}

function diagnostics(resultCount: number, limit: number) {
  return { resultCount, limit, untrustedEvidence: true as const };
}

function unsupported(tool: string): ResearchToolExecution<never> {
  return toolFailure("index-inventory-unsupported", `${tool} is not supported by the selected index.`);
}

function unknownProperty(input: InventoryInput, allowed: string[]): string | undefined {
  return Object.keys(input).find((key) => !allowed.includes(key));
}

function readString(value: unknown, maxLength: number): string | undefined {
  const parsed = readOptionalString(value, maxLength);
  return parsed === false ? undefined : parsed;
}

function readOptionalString(value: unknown, maxLength: number): string | false | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.length <= maxLength ? trimmed : false;
}

function optionalStringValue(value: unknown, maxLength: number): string | undefined {
  const parsed = readOptionalString(value, maxLength);
  return parsed === false ? undefined : parsed;
}

function readStringArray(value: unknown): string[] | false | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 12) return false;
  const items = value.map((item) => (typeof item === "string" ? item.trim() : ""));
  return items.every((item) => item.length > 0 && item.length <= 160) ? items : false;
}

function readLimit(value: unknown, fallback: number, max: number, min = 1): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== false)) as T;
}
