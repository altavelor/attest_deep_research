import { stableId } from "@adapters/extractors/common";
import { ContextFileProvider } from "@application/ports";
import { VaultWriter } from "@application/ports";
import { normalizeVaultPath } from "@shared";
import { Extractor } from "@application/ports";
import { ChatToolCall, ChatToolDefinition } from "@core/agent";
import { Citation } from "@core/model";
import { ExtractedChunk, RetrievedChunk } from "@core/model";
import { estimateTextTokens } from "@core/research";
import { applyNoteCitations, maxFootnoteNumber } from "./noteCitations";
import {
  NOTE_MUTATION_TOOL_DEFINITIONS,
  NOTE_TOOL_DEFINITIONS,
} from "./noteToolDefinitions";

export type NoteActionType = "create" | "update" | "delete";

export interface NoteActionRequest {
  action: NoteActionType;
  path: string;
  content?: string;
}

export interface NoteActionConfirmation {
  confirm(request: NoteActionRequest): Promise<boolean>;
}

export const AUTO_CONFIRM: NoteActionConfirmation = {
  confirm: async () => true,
};

export function validateMutablePath(path: string): { ok: true } | { ok: false; reason: string } {
  if (!path || !path.endsWith(".md")) {
    return { ok: false, reason: "invalid-path" };
  }
  if (path.split("/").some((segment) => segment === ".." || segment === ".")) {
    return { ok: false, reason: "invalid-path" };
  }
  if (path === ".ixplorer" || path.startsWith(".ixplorer/")) {
    return { ok: false, reason: "forbidden-path" };
  }
  return { ok: true };
}

export interface NoteToolServiceOptions {
  files: ContextFileProvider;
  extractors: Extractor[];
  getActiveFilePath?: () => string | undefined;
  readNoteMaxChars?: number;
  searchResultLimit?: number;
  listLimit?: number;
  writer?: VaultWriter;
  confirmation?: NoteActionConfirmation;
  noteMutationAccess?: boolean;
  /**
   * Supplies the citations gathered during the current research run so that raw
   * evidence-ID tokens written into notes can be rewritten as footnote links.
   */
  citationProvider?: () => readonly Citation[];
}

export interface NoteToolExecution {
  ok: boolean;
  result: string;
  diagnostic?: Record<string, unknown>;
}

type NoteToolName = "read_note" | "search_notes" | "list_notes" | "get_active_note";
type NoteMutationToolName = "create_note" | "update_note" | "delete_note";
type AnyNoteToolName = NoteToolName | NoteMutationToolName;

const DEFAULT_READ_NOTE_MAX_CHARS = 16_000;
const DEFAULT_SEARCH_RESULT_LIMIT = 5;
const DEFAULT_LIST_LIMIT = 100;
const SUPPORTED_TOOL_NAMES = new Set<NoteToolName>([
  "read_note",
  "search_notes",
  "list_notes",
  "get_active_note",
]);
const MUTATION_TOOL_NAMES = new Set<NoteMutationToolName>([
  "create_note",
  "update_note",
  "delete_note",
]);


export class NoteToolService {
  private readonly files: ContextFileProvider;
  private readonly extractors: Extractor[];
  private readonly getActiveFilePath?: () => string | undefined;
  private readonly readNoteMaxChars: number;
  private readonly searchResultLimit: number;
  private readonly listLimit: number;
  private readonly writer?: VaultWriter;
  private readonly confirmation: NoteActionConfirmation;
  private readonly noteMutationAccess: boolean;
  private citationProvider?: () => readonly Citation[];

  constructor(options: NoteToolServiceOptions) {
    this.files = options.files;
    this.extractors = options.extractors;
    this.getActiveFilePath = options.getActiveFilePath;
    this.readNoteMaxChars = options.readNoteMaxChars ?? DEFAULT_READ_NOTE_MAX_CHARS;
    this.searchResultLimit = options.searchResultLimit ?? DEFAULT_SEARCH_RESULT_LIMIT;
    this.listLimit = options.listLimit ?? DEFAULT_LIST_LIMIT;
    this.writer = options.writer;
    this.confirmation = options.confirmation ?? AUTO_CONFIRM;
    this.noteMutationAccess = options.noteMutationAccess ?? false;
    this.citationProvider = options.citationProvider;
  }

  /**
   * Registers the source of research citations used to rewrite evidence-ID tokens in
   * written notes. Wired after construction because the evidence registry is created
   * per research run, while the service is long-lived.
   */
  setCitationProvider(provider: () => readonly Citation[]): void {
    this.citationProvider = provider;
  }

  private citations(): readonly Citation[] {
    return this.citationProvider?.() ?? [];
  }

  definitions(): ChatToolDefinition[] {
    const defs: ChatToolDefinition[] = [...NOTE_TOOL_DEFINITIONS];
    if (this.noteMutationAccess && this.writer) {
      defs.push(...NOTE_MUTATION_TOOL_DEFINITIONS);
    }
    return defs;
  }

  mutationEnabled(): boolean {
    return this.noteMutationAccess && this.writer !== undefined;
  }

  supports(name: string): name is AnyNoteToolName {
    if (SUPPORTED_TOOL_NAMES.has(name as NoteToolName)) return true;
    if (MUTATION_TOOL_NAMES.has(name as NoteMutationToolName)) {
      return this.noteMutationAccess && this.writer !== undefined;
    }
    return false;
  }

  async execute(toolCall: ChatToolCall): Promise<NoteToolExecution> {
    if (!this.supports(toolCall.name)) {
      return jsonResult(false, { ok: false, reason: "unknown-tool", tool: toolCall.name });
    }

    switch (toolCall.name) {
      case "create_note":
        return this.createNote(toolCall.arguments);
      case "update_note":
        return this.updateNote(toolCall.arguments);
      case "delete_note":
        return this.deleteNote(toolCall.arguments);
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

  private async createNote(args: Record<string, unknown>): Promise<NoteToolExecution> {
    const writer = this.writer!;
    const path = normalizePathArg(args.path);
    const validation = validateMutablePath(path);
    if (!validation.ok) {
      return jsonResult(false, { ok: false, reason: validation.reason, path });
    }

    const overwrite = args.overwrite === true;
    const exists = await writer.exists(path);
    if (exists && !overwrite) {
      return jsonResult(false, {
        ok: false,
        reason: "already-exists",
        path,
        hint: "Set overwrite:true to replace the existing file, or use update_note to modify it.",
      });
    }

    const confirmed = await this.confirmation.confirm({ action: "create", path });
    if (!confirmed) {
      return jsonResult(false, { ok: false, reason: "user-cancelled", path });
    }

    const rawContent = typeof args.content === "string" ? args.content : "";
    const content = applyNoteCitations(rawContent, this.citations()).content;
    const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    if (folder) {
      await writer.ensureFolder(folder);
    }
    await writer.createFile(path, content);
    return jsonResult(true, { ok: true, path, created: true });
  }

  private async updateNote(args: Record<string, unknown>): Promise<NoteToolExecution> {
    const writer = this.writer!;
    const path = normalizePathArg(args.path);
    const validation = validateMutablePath(path);
    if (!validation.ok) {
      return jsonResult(false, { ok: false, reason: validation.reason, path });
    }

    const exists = await writer.exists(path);
    if (!exists) {
      return jsonResult(false, {
        ok: false,
        reason: "not-found",
        path,
        hint: "Use create_note to create the file first.",
      });
    }

    const confirmed = await this.confirmation.confirm({ action: "update", path });
    if (!confirmed) {
      return jsonResult(false, { ok: false, reason: "user-cancelled", path });
    }

    const rawContent = typeof args.content === "string" ? args.content : "";
    const mode = args.mode === "append" || args.mode === "prepend" ? args.mode : "replace";

    const before = await writer.readFile(path);
    // Continue footnote numbering past any already present in the file so appended or
    // prepended citations do not collide with existing ones.
    const startNumber = mode === "replace" ? 1 : maxFootnoteNumber(before) + 1;
    const content = applyNoteCitations(rawContent, this.citations(), startNumber).content;
    if (mode === "replace") {
      await writer.modifyFile(path, content);
    } else if (mode === "append") {
      await writer.appendFile(path, content);
    } else {
      await writer.modifyFile(path, `${content}\n\n${before}`);
    }
    const after = await writer.readFile(path);

    return jsonResult(true, {
      ok: true,
      path,
      mode,
      // Display-only fields consumed by the chat UI to render an edit diff.
      before: capDiffText(before),
      after: capDiffText(after),
    });
  }

  private async deleteNote(args: Record<string, unknown>): Promise<NoteToolExecution> {
    const writer = this.writer!;
    const path = normalizePathArg(args.path);
    if (!path) {
      return jsonResult(false, { ok: false, reason: "missing-path" });
    }
    if (path === ".ixplorer" || path.startsWith(".ixplorer/")) {
      return jsonResult(false, { ok: false, reason: "forbidden-path", path });
    }

    const exists = await writer.exists(path);
    if (!exists) {
      return jsonResult(false, { ok: false, reason: "not-found", path });
    }

    const confirmed = await this.confirmation.confirm({ action: "delete", path });
    if (!confirmed) {
      return jsonResult(false, { ok: false, reason: "user-cancelled", path });
    }

    await writer.trashFile(path);
    return jsonResult(true, { ok: true, path, trashed: true });
  }

  private async readNote(args: Record<string, unknown>): Promise<NoteToolExecution> {
    const path = normalizePathArg(args.path);
    if (!path) {
      return jsonResult(false, { ok: false, reason: "missing-path" });
    }
    return this.readSupportedPath(path, readPositiveNumber(args.maxChars) ?? this.readNoteMaxChars);
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
        evidenceId: packed.chunks[0]?.id,
        evidenceSource: packed.chunks[0]?.source,
        chunkCount: chunks.length,
        returnedChunkCount: packed.chunks.length,
        content: packed.content,
        chunks: packed.chunks.map((chunk) => ({
          id: chunk.id,
          source: sourceSummary(chunk),
          evidenceSource: chunk.source,
          text: chunk.text,
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

    const limit = boundLimit(readPositiveNumber(args.limit), this.searchResultLimit, 20);
    const results = await this.searchPaths(query, limit);
    return jsonResult(true, {
      ok: true,
      query,
      source: "path",
      editingOnly: true,
      results,
    });
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

const DIFF_TEXT_CAP = 8_000;

function capDiffText(value: string): string {
  return value.length > DIFF_TEXT_CAP ? value.slice(0, DIFF_TEXT_CAP) : value;
}

function jsonResult(ok: boolean, value: unknown): NoteToolExecution {
  return { ok, result: JSON.stringify(value) };
}
