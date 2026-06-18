import { stableId } from "../extractors/common";
import { isInternalSkillPath, normalizeVaultPath } from "../shared/pathFilters";
import {
  ChatToolCall,
  ChatToolDefinition,
  Extractor,
  ExtractedChunk,
  RetrievedChunk,
} from "../shared/types";
import { ContextFileProvider } from "./ContextAssembler";
import { estimateTextTokens } from "./prompts";
import { ResearchRetriever } from "./types";
import { SKILL_ROOT, SkillRegistry } from "../skills/SkillRegistry";

export interface NoteToolServiceOptions {
  files: ContextFileProvider;
  extractors: Extractor[];
  retriever?: ResearchRetriever;
  getActiveFilePath?: () => string | undefined;
  readNoteMaxChars?: number;
  searchResultLimit?: number;
  searchSnippetChars?: number;
  listLimit?: number;
  skillRegistry?: SkillRegistry;
  skillMaxTokens?: number;
}

export interface NoteToolExecution {
  ok: boolean;
  result: string;
  diagnostic?: Record<string, unknown>;
}

type NoteToolName = "read_note" | "search_notes" | "list_notes" | "get_active_note";

const DEFAULT_READ_NOTE_MAX_CHARS = 16_000;
const DEFAULT_SEARCH_RESULT_LIMIT = 5;
const DEFAULT_SEARCH_SNIPPET_CHARS = 1_000;
const DEFAULT_LIST_LIMIT = 100;
const SUPPORTED_TOOL_NAMES = new Set<NoteToolName>([
  "read_note",
  "search_notes",
  "list_notes",
  "get_active_note",
]);

export const NOTE_TOOL_DEFINITIONS: ChatToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "read_note",
      description:
        "Read a supported vault file by path using the same extraction pipeline as attached Ixplorer context. Returns compact JSON with extracted chunks and truncation diagnostics.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Vault-relative file path." },
          maxChars: {
            type: "number",
            description: "Optional maximum content characters to return.",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_notes",
      description:
        "Search supported vault notes. Uses Ixplorer retrieval when available, otherwise falls back to path/name matching. Returns paths and short snippets, not full notes.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query." },
          limit: { type: "number", description: "Maximum results to return. Default 5." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_notes",
      description:
        "List supported vault context files. Supports optional path prefix, filename query, and result limit.",
      parameters: {
        type: "object",
        properties: {
          prefix: { type: "string", description: "Optional path prefix/folder filter." },
          query: { type: "string", description: "Optional case-insensitive path query." },
          limit: { type: "number", description: "Maximum paths to return. Default 100." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_active_note",
      description:
        "Return the active Obsidian file path and extracted content when the active file is supported.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
];

export class NoteToolService {
  private readonly files: ContextFileProvider;
  private readonly extractors: Extractor[];
  private readonly retriever?: ResearchRetriever;
  private readonly getActiveFilePath?: () => string | undefined;
  private readonly readNoteMaxChars: number;
  private readonly searchResultLimit: number;
  private readonly searchSnippetChars: number;
  private readonly listLimit: number;
  private readonly skillRegistry?: SkillRegistry;
  private readonly skillMaxTokens?: number;

  constructor(options: NoteToolServiceOptions) {
    this.files = options.files;
    this.extractors = options.extractors;
    this.retriever = options.retriever;
    this.getActiveFilePath = options.getActiveFilePath;
    this.readNoteMaxChars = options.readNoteMaxChars ?? DEFAULT_READ_NOTE_MAX_CHARS;
    this.searchResultLimit = options.searchResultLimit ?? DEFAULT_SEARCH_RESULT_LIMIT;
    this.searchSnippetChars = options.searchSnippetChars ?? DEFAULT_SEARCH_SNIPPET_CHARS;
    this.listLimit = options.listLimit ?? DEFAULT_LIST_LIMIT;
    this.skillRegistry = options.skillRegistry;
    this.skillMaxTokens = options.skillMaxTokens;
  }

  definitions(): ChatToolDefinition[] {
    return NOTE_TOOL_DEFINITIONS;
  }

  supports(name: string): name is NoteToolName {
    return SUPPORTED_TOOL_NAMES.has(name as NoteToolName);
  }

  async execute(toolCall: ChatToolCall): Promise<NoteToolExecution> {
    if (!this.supports(toolCall.name)) {
      return jsonResult(false, { ok: false, reason: "unknown-tool", tool: toolCall.name });
    }

    switch (toolCall.name) {
      case "read_note":
        return this.readNote(toolCall.arguments);
      case "search_notes":
        return this.searchNotes(toolCall.arguments);
      case "list_notes":
        return this.listNotes(toolCall.arguments);
      case "get_active_note":
        return this.getActiveNote();
    }
  }

  private async readNote(args: Record<string, unknown>): Promise<NoteToolExecution> {
    const path = normalizePathArg(args.path);
    if (!path) {
      return jsonResult(false, { ok: false, reason: "missing-path" });
    }

    if (path.startsWith(`${SKILL_ROOT}/`)) {
      return this.readSkill(path);
    }

    return this.readSupportedPath(path, readPositiveNumber(args.maxChars) ?? this.readNoteMaxChars);
  }

  private async readSkill(path: string): Promise<NoteToolExecution> {
    if (!this.skillRegistry) {
      return jsonResult(false, { ok: false, reason: "invalid-skill", path });
    }

    const snapshot = await this.skillRegistry.getSnapshot();
    const skill = snapshot.skills.find((candidate) => candidate.path === path);
    if (!skill) {
      return jsonResult(false, { ok: false, reason: "invalid-skill", path });
    }

    try {
      const loaded = await this.skillRegistry.load(skill, { maxTokens: this.skillMaxTokens });
      const result = jsonResult(true, {
        ok: true,
        skill: true,
        id: skill.id,
        name: skill.name,
        path,
        content: loaded.content,
        includedTokens: loaded.estimatedTokens,
        characters: loaded.characters,
        truncated: false,
      });
      return {
        ...result,
        diagnostic: {
          skillId: skill.id,
          skillName: skill.name,
          skillPath: path,
          loadedCharacters: loaded.characters,
          loadedTokens: loaded.estimatedTokens,
          truncated: false,
        },
      };
    } catch (error) {
      return jsonResult(false, {
        ok: false,
        path,
        reason:
          typeof error === "object" && error !== null && "code" in error
            ? String(error.code)
            : "skill-read-failed",
      });
    }
  }

  private async getActiveNote(): Promise<NoteToolExecution> {
    const path = normalizePathArg(this.getActiveFilePath?.());
    if (!path) {
      return jsonResult(true, { ok: false, reason: "no-active-note" });
    }

    const available = await this.files.listPaths();
    if (!available.includes(path)) {
      return jsonResult(true, { ok: false, reason: "unsupported-file-type", path });
    }

    return this.readSupportedPath(path, this.readNoteMaxChars);
  }

  private async readSupportedPath(path: string, maxChars: number): Promise<NoteToolExecution> {
    const available = await this.files.listPaths();
    if (!available.includes(path)) {
      return jsonResult(false, { ok: false, reason: "not-found-or-unsupported", path });
    }

    const extractor = this.extractors.find((candidate) => candidate.supports(path));
    if (!extractor) {
      return jsonResult(false, { ok: false, reason: "unsupported-file-type", path });
    }

    try {
      const data = await this.files.readFile(path);
      const chunks = await extractor.extract({
        path,
        data,
        modifiedTime: (await this.files.getModifiedTime?.(path)) ?? 0,
        size: await this.files.getSize?.(path),
      });
      const packed = packExtractedChunks(chunks, maxChars);
      return jsonResult(true, {
        ok: true,
        path,
        chunkCount: chunks.length,
        returnedChunkCount: packed.chunks.length,
        content: packed.content,
        chunks: packed.chunks.map((chunk) => ({
          id: chunk.id,
          source: sourceSummary(chunk),
          tokens: estimateTextTokens(chunk.text),
        })),
        includedTokens: estimateTextTokens(packed.content),
        droppedTokens: Math.max(
          0,
          estimateTextTokens(chunks.map((chunk) => chunk.text).join("\n\n")) -
            estimateTextTokens(packed.content),
        ),
        truncated: packed.truncated,
        maxChars,
      });
    } catch (error) {
      return jsonResult(false, {
        ok: false,
        path,
        reason: "read-failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async searchNotes(args: Record<string, unknown>): Promise<NoteToolExecution> {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) {
      return jsonResult(false, { ok: false, reason: "missing-query" });
    }

    const limit = boundLimit(readPositiveNumber(args.limit), this.searchResultLimit, 10);
    const retrieval = await this.searchWithRetriever(query, limit);
    if (retrieval.length > 0) {
      return jsonResult(true, {
        ok: true,
        query,
        source: "retrieval",
        results: retrieval.map((chunk) => ({
          path: "path" in chunk.source ? chunk.source.path : chunk.source.title,
          id: chunk.id,
          score: chunk.score,
          source: sourceSummary(chunk),
          snippet: truncateText(chunk.text, this.searchSnippetChars),
        })),
      });
    }

    const fallback = await this.searchPaths(query, limit);
    return jsonResult(true, { ok: true, query, source: "path", results: fallback });
  }

  private async searchWithRetriever(query: string, limit: number): Promise<RetrievedChunk[]> {
    if (!this.retriever) {
      return [];
    }

    try {
      const result = await this.retriever.search(query, { limit, includeWebResults: false });
      return result.chunks
        .filter((chunk) => !("path" in chunk.source && isInternalSkillPath(chunk.source.path)))
        .slice(0, limit);
    } catch {
      return [];
    }
  }

  private async searchPaths(
    query: string,
    limit: number,
  ): Promise<Array<{ path: string; snippet: string }>> {
    const lowerQuery = query.toLocaleLowerCase();
    const paths = await this.files.listPaths();
    return paths
      .filter((path) => path.toLocaleLowerCase().includes(lowerQuery))
      .slice(0, limit)
      .map((path) => ({ path, snippet: path }));
  }

  private async listNotes(args: Record<string, unknown>): Promise<NoteToolExecution> {
    const prefix = normalizePathArg(args.prefix);
    const query = typeof args.query === "string" ? args.query.trim().toLocaleLowerCase() : "";
    const limit = boundLimit(readPositiveNumber(args.limit), this.listLimit, 500);
    const paths = (await this.files.listPaths())
      .filter((path) => !prefix || path === prefix || path.startsWith(`${prefix}/`))
      .filter((path) => !query || path.toLocaleLowerCase().includes(query))
      .sort();

    return jsonResult(true, {
      ok: true,
      paths: paths.slice(0, limit),
      count: Math.min(paths.length, limit),
      totalCount: paths.length,
      hasMore: paths.length > limit,
      limit,
    });
  }
}

function packExtractedChunks(
  chunks: ExtractedChunk[],
  maxChars: number,
): { chunks: RetrievedChunk[]; content: string; truncated: boolean } {
  const packed: RetrievedChunk[] = [];
  const parts: string[] = [];
  let used = 0;

  for (const [index, chunk] of chunks.entries()) {
    const separator = parts.length > 0 ? "\n\n" : "";
    const remaining = maxChars - used - separator.length;
    if (remaining <= 0) {
      return { chunks: packed, content: parts.join("\n\n"), truncated: true };
    }

    const text = chunk.text.length > remaining ? chunk.text.slice(0, remaining) : chunk.text;
    parts.push(text);
    packed.push({
      ...chunk,
      id: chunk.id || stableId(`${sourcePath(chunk)}:${index}`),
      text,
      score: 1,
    });
    used += separator.length + text.length;

    if (text.length < chunk.text.length) {
      return { chunks: packed, content: parts.join("\n\n"), truncated: true };
    }
  }

  return { chunks: packed, content: parts.join("\n\n"), truncated: false };
}

function sourceSummary(chunk: ExtractedChunk): Record<string, unknown> {
  const source = chunk.source;
  if ("path" in source) {
    return {
      kind: source.kind,
      path: source.path,
      title: source.title,
      ...(source.kind === "markdown" ? { headingPath: source.headingPath } : {}),
      ...(source.kind === "pdf" ? { pageNumber: source.pageNumber } : {}),
    };
  }

  return { kind: source.kind, title: source.title };
}

function sourcePath(chunk: ExtractedChunk): string {
  return "path" in chunk.source ? chunk.source.path : chunk.source.title;
}

function normalizePathArg(value: unknown): string {
  return typeof value === "string" ? normalizeVaultPath(value.trim()) : "";
}

function readPositiveNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }

  return undefined;
}

function boundLimit(value: number | undefined, fallback: number, max: number): number {
  return Math.max(1, Math.min(max, value ?? fallback));
}

function truncateText(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars)}...`;
}

function jsonResult(ok: boolean, value: unknown): NoteToolExecution {
  return { ok, result: JSON.stringify(value) };
}
