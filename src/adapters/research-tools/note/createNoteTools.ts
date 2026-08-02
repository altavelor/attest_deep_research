// Note-tool factory (stage 1 of the tool-uniformity work). Declares the note
// tools as ordinary `defineTool` definitions whose thin `execute` delegates to
// the NoteToolService — which does all the work. Lives in adapters because it
// binds the concrete service; the declarations themselves only touch the port.

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
import { bool, defineTool, enumOf, FieldSchema, num, str, text } from "@application/sources/tools";

/** Permission names a run may grant; mapped from availability by the composition. */
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

/** Shared thin delegation: hand the call to the service and adapt its DTO. */
async function runNoteTool(
  service: NoteToolService,
  name: string,
  input: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolExecution<unknown>> {
  const execution = await service.execute({ id: context.callId, name, arguments: input });

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

  return { ok: true, value, diagnostic: execution.diagnostic };
}

function defineNoteTool(spec: NoteToolSpec): new (service: NoteToolService) => Tool {
  return defineTool<NoteToolService, Record<string, unknown>, unknown>({
    name: spec.name,
    description: spec.description,
    schema: spec.schema,
    requires: spec.requires,
    execute: (service, input, context) => runNoteTool(service, spec.name, input, context),
  });
}

const ReadNoteTool = defineNoteTool({
  name: READ_NOTE_TOOL,
  description:
    "Read the raw content of a vault note by path. For editing only — returned text is NOT citable evidence. To search authoritative sources, use search_index or search_web instead.",
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
    "Return the currently open Obsidian file path and its raw content. For editing only — not citable evidence. The active note content is already provided as attached context at the start of this conversation.",
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

const NOTE_TOOLS: ReadonlyArray<new (service: NoteToolService) => Tool> = [
  ReadNoteTool,
  SearchNotesTool,
  ListNotesTool,
  GetActiveNoteTool,
  CreateNoteTool,
  UpdateNoteTool,
  DeleteNoteTool,
];

/** Build the note tools bound to a service. Gating is per-tool via `requires`. */
export function createNoteTools(service: NoteToolService): Tool[] {
  return NOTE_TOOLS.map((NoteTool) => new NoteTool(service));
}
