import { Tool, ToolContext, ToolExecution, ToolPermissions, toolFailure } from "@core/agent";
import {
  CREATE_NOTE_TOOL,
  DELETE_NOTE_TOOL,
  GET_ACTIVE_NOTE_TOOL,
  LIST_NOTES_TOOL,
  READ_NOTE_TOOL,
  SEARCH_NOTES_TOOL,
  UPDATE_NOTE_TOOL,
} from "@core/agent";
import { NoteToolService } from "@application/research";
import { EvidenceRegistry } from "@application/sources";
import { SourceReference } from "@core/model";
import { bool, defineTool, enumOf, FieldSchema, num, str, text } from "@application/sources/tools";

export const NOTE_PERMISSIONS = {
  read: "note.read",
  active: "note.active",
  mutate: "note.mutate",
} as const;

const MAX_PATH_CHARS = 500;
const MAX_QUERY_CHARS = 500;

interface NoteToolSpec {
  name: string;
  description: string;
  schema: FieldSchema;
  requires(permissions: ToolPermissions): boolean;
}

interface NoteToolDeps {
  service: NoteToolService;
  evidence?: EvidenceRegistry;
  evidenceBudget?: { remainingChars: number; charged: Set<string> };
}

type NoteEvidenceTool = "read_note" | "get_active_note";

const EVIDENCE_TOOLS = new Set<string>([READ_NOTE_TOOL, GET_ACTIVE_NOTE_TOOL]);

const MAX_REGISTERED_NOTE_EVIDENCE_CHARS = 96_000;

/** Shared thin delegation: hand the call to the service and adapt its DTO. */
async function runNoteTool(
  deps: NoteToolDeps,
  name: string,
  input: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolExecution<unknown>> {
  const execution = await deps.service.execute({ id: context.callId, name, arguments: input });

  let value: unknown;
  try {
    value = JSON.parse(execution.result) as unknown;
  } catch {
    throw new Error(`Note tool ${name} returned invalid JSON.`);
  }

  if (!execution.ok) {
    const payload =
      typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
    const reason = typeof payload.reason === "string" ? payload.reason : "note-tool-failed";
    const hint = typeof payload.hint === "string" ? payload.hint : undefined;
    return toolFailure(reason, `Note tool ${name} failed.`, false, hint ? { hint } : undefined);
  }

  if (deps.evidence && deps.evidenceBudget && EVIDENCE_TOOLS.has(name)) {
    const registered = registerReadChunks(
      deps.evidence,
      deps.evidenceBudget,
      name as NoteEvidenceTool,
      value,
      context.callId,
    );
    redactUnregisteredIds(value, registered);
  }

  return { ok: true, value, diagnostic: execution.diagnostic };
}

/**
 * Registers the chunks a note read returned so their `evidenceId` becomes a citable
 * token, while the run's character budget for note evidence lasts. Returns the ids that
 * were actually registered. Skips any payload that is not a well-formed chunk and
 * swallows a registry refusal: the value is parsed from a tool DTO and a defect in it
 * must never fail an otherwise successful read.
 */
function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

/**
 * Verifies a source carries every field its kind requires. A partially formed source
 * still registers, but builds its citation label from absent fields, so the chunk it
 * describes is better left uncitable than recorded with broken provenance.
 */
function isSourceReference(value: unknown): value is SourceReference {
  if (typeof value !== "object" || value === null) return false;
  const source = value as Record<string, unknown>;
  if (typeof source.id !== "string" || !source.id) return false;
  if (typeof source.title !== "string") return false;
  switch (source.kind) {
    case "markdown":
      return typeof source.path === "string" && isStringArray(source.headingPath);
    case "pdf":
      return typeof source.path === "string" && typeof source.pageNumber === "number";
    case "document":
      return typeof source.path === "string" && typeof source.format === "string";
    case "web":
      return (
        typeof source.url === "string" &&
        typeof source.snippet === "string" &&
        typeof source.retrievedAt === "string" &&
        typeof source.wasContentFetched === "boolean"
      );
    default:
      return false;
  }
}

function registerReadChunks(
  evidence: EvidenceRegistry,
  budget: { remainingChars: number; charged: Set<string> },
  tool: NoteEvidenceTool,
  value: unknown,
  callId: string,
): Set<string> {
  const registered = new Set<string>();
  if (typeof value !== "object" || value === null) return registered;
  const payload = value as Record<string, unknown>;
  if (payload.ok !== true || !Array.isArray(payload.chunks)) return registered;

  for (const entry of payload.chunks) {
    if (typeof entry !== "object" || entry === null) continue;
    const chunk = entry as Record<string, unknown>;
    const evidenceId = chunk.id;
    const source = chunk.evidenceSource;
    const content = chunk.text;
    if (typeof evidenceId !== "string" || !evidenceId) continue;
    if (typeof content !== "string") continue;
    if (!isSourceReference(source)) continue;
    const charged = budget.charged.has(evidenceId);
    if (!charged && content.length > budget.remainingChars) continue;
    try {
      evidence.registerNoteEvidence({ evidenceId, source, content }, { callId, tool });
      if (!charged) {
        budget.remainingChars -= content.length;
        budget.charged.add(evidenceId);
      }
      registered.add(evidenceId);
    } catch {
      continue;
    }
  }
  return registered;
}

/**
 * Strips the identifier from every chunk that was not registered, so the result never
 * offers the model a token it cannot cite. Citing an unregistered id would have the
 * citation silently removed from the answer, leaving the claim unsourced.
 */
function isRegistered(id: unknown, registered: ReadonlySet<string>): boolean {
  return typeof id === "string" && registered.has(id);
}

function redactUnregisteredIds(value: unknown, registered: ReadonlySet<string>): void {
  if (typeof value !== "object" || value === null) return;
  const payload = value as Record<string, unknown>;
  if (!Array.isArray(payload.chunks)) return;

  for (const entry of payload.chunks) {
    if (typeof entry !== "object" || entry === null) continue;
    const chunk = entry as Record<string, unknown>;
    if (chunk.id !== undefined && !isRegistered(chunk.id, registered)) {
      delete chunk.id;
      delete chunk.evidenceSource;
      chunk.citable = false;
    }
  }
  if (payload.evidenceId !== undefined && !isRegistered(payload.evidenceId, registered)) {
    delete payload.evidenceId;
  }
}

function defineNoteTool(spec: NoteToolSpec): new (deps: NoteToolDeps) => Tool {
  return defineTool<NoteToolDeps, Record<string, unknown>, unknown>({
    name: spec.name,
    description: spec.description,
    schema: spec.schema,
    requires: (availability) => spec.requires(availability),
    execute: (deps, input, context) => runNoteTool(deps, spec.name, input, context),
  });
}

const ReadNoteTool = defineNoteTool({
  name: READ_NOTE_TOOL,
  description:
    "Read the raw content of a vault note by path. The returned chunks are registered evidence: cite a claim with the `id` of the chunk that supports it. The top-level `evidenceId` names the first chunk only, so do not reuse it for later chunks. A chunk with no `id` is context, not a citable source. Navigation results from search_notes and list_notes are not evidence.",
  schema: {
    path: str(MAX_PATH_CHARS, { required: true, description: "Vault-relative file path." }),
    maxChars: num({
      min: 1,
      max: 200_000,
      description: "Optional maximum content characters to return.",
    }),
  },
  requires: (p) => p.has(NOTE_PERMISSIONS.read),
});

const SearchNotesTool = defineNoteTool({
  name: SEARCH_NOTES_TOOL,
  description:
    "Find vault notes by keyword match in path or filename. Returns matching paths for editing navigation. Results are NOT evidence and cannot be cited or used to reason about the question.",
  schema: {
    query: str(MAX_QUERY_CHARS, { required: true, description: "Search query." }),
    limit: num({ min: 1, max: 50, description: "Maximum results to return. Default 5." }),
  },
  requires: (p) => p.has(NOTE_PERMISSIONS.read),
});

const ListNotesTool = defineNoteTool({
  name: LIST_NOTES_TOOL,
  description:
    "List vault notes by path prefix or keyword. For editing navigation only — results are not evidence.",
  schema: {
    prefix: str(MAX_PATH_CHARS, { description: "Optional path prefix/folder filter." }),
    query: str(MAX_QUERY_CHARS, { description: "Optional case-insensitive path query." }),
    limit: num({ min: 1, max: 1000, description: "Maximum paths to return. Default 100." }),
  },
  requires: (p) => p.has(NOTE_PERMISSIONS.read),
});

const GetActiveNoteTool = defineNoteTool({
  name: GET_ACTIVE_NOTE_TOOL,
  description:
    "Return the currently open Obsidian file path and its raw content. The returned chunks are registered evidence: cite a claim with the `id` of the chunk that supports it. The top-level `evidenceId` names the first chunk only, so do not reuse it for later chunks. The active note content is already provided as attached context at the start of this conversation.",
  schema: {},
  requires: (p) => p.has(NOTE_PERMISSIONS.active),
});

const CreateNoteTool = defineNoteTool({
  name: CREATE_NOTE_TOOL,
  description:
    "Create a new markdown note at the given vault-relative path. Returns {ok:false, reason:'already-exists'} if the file exists — set overwrite:true to replace it, or use update_note to modify it.",
  schema: {
    path: str(MAX_PATH_CHARS, {
      required: true,
      description: "Vault-relative path ending in .md.",
    }),
    content: text({ required: true, description: "Markdown content for the new note." }),
    overwrite: bool({ description: "If true, overwrite an existing file. Default false." }),
  },
  requires: (p) => p.has(NOTE_PERMISSIONS.mutate),
});

const UpdateNoteTool = defineNoteTool({
  name: UPDATE_NOTE_TOOL,
  description:
    "Update an existing markdown note. CAUTION: mode=replace (default) destroys all existing content. Prefer mode=append to add content or mode=prepend to insert at the top. mode=prepend is non-atomic: avoid when concurrent edits are likely. Returns {ok:false, reason:'not-found'} if the file does not exist — use create_note first.",
  schema: {
    path: str(MAX_PATH_CHARS, {
      required: true,
      description: "Vault-relative path ending in .md.",
    }),
    content: text({ required: true, description: "Content to write." }),
    mode: enumOf(["replace", "append", "prepend"], {
      description:
        "replace: overwrite entire file (destructive). append: add to end. prepend: add to beginning. Default: replace.",
    }),
  },
  requires: (p) => p.has(NOTE_PERMISSIONS.mutate),
});

const DeleteNoteTool = defineNoteTool({
  name: DELETE_NOTE_TOOL,
  description:
    "Move a vault note to the system trash. The file is not permanently deleted and can be recovered. Returns {ok:false, reason:'not-found'} if the file does not exist.",
  schema: {
    path: str(MAX_PATH_CHARS, { required: true, description: "Vault-relative file path." }),
  },
  requires: (p) => p.has(NOTE_PERMISSIONS.mutate),
});

const NOTE_TOOLS: ReadonlyArray<new (deps: NoteToolDeps) => Tool> = [
  ReadNoteTool,
  SearchNotesTool,
  ListNotesTool,
  GetActiveNoteTool,
  CreateNoteTool,
  UpdateNoteTool,
  DeleteNoteTool,
];

/**
 * Build the note tools bound to a service. Gating is per-tool via `requires`. When an
 * evidence registry is supplied, note reads register their chunks so the model may cite
 * them by `evidenceId`, within a character budget shared by the direct reads of one run.
 */
export function createNoteTools(service: NoteToolService, evidence?: EvidenceRegistry): Tool[] {
  const deps: NoteToolDeps = {
    service,
    ...(evidence
      ? {
          evidence,
          evidenceBudget: {
            remainingChars: MAX_REGISTERED_NOTE_EVIDENCE_CHARS,
            charged: new Set<string>(),
          },
        }
      : {}),
  };
  return NOTE_TOOLS.map((NoteTool) => new NoteTool(deps));
}
