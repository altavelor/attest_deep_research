// Note-tool JSON schemas (SPEC R5). Pure tool definitions, owned by the
// application layer so both the concrete NoteToolService (adapters) and the
// note tool-handlers can share them.

import { ChatToolDefinition } from "../../../core/agent/tool";
import {
  CREATE_NOTE_TOOL,
  DELETE_NOTE_TOOL,
  GET_ACTIVE_NOTE_TOOL,
  LIST_NOTES_TOOL,
  READ_NOTE_TOOL,
  SEARCH_NOTES_TOOL,
  UPDATE_NOTE_TOOL,
} from "../../../core/agent/toolNames";

export const NOTE_MUTATION_TOOL_DEFINITIONS: ChatToolDefinition[] = [
  {
    type: "function",
    function: {
      name: CREATE_NOTE_TOOL,
      description:
        "Create a new markdown note at the given vault-relative path. Returns {ok:false, reason:'already-exists'} if the file exists — set overwrite:true to replace it, or use update_note to modify it.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            maxLength: 500,
            description: "Vault-relative path ending in .md.",
          },
          content: { type: "string", description: "Markdown content for the new note." },
          overwrite: {
            type: "boolean",
            description: "If true, overwrite an existing file. Default false.",
          },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: UPDATE_NOTE_TOOL,
      description:
        "Update an existing markdown note. CAUTION: mode=replace (default) destroys all existing content. Prefer mode=append to add content or mode=prepend to insert at the top. mode=prepend is non-atomic: avoid when concurrent edits are likely. Returns {ok:false, reason:'not-found'} if the file does not exist — use create_note first.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            maxLength: 500,
            description: "Vault-relative path ending in .md.",
          },
          content: { type: "string", description: "Content to write." },
          mode: {
            type: "string",
            enum: ["replace", "append", "prepend"],
            description:
              "replace: overwrite entire file (destructive). append: add to end. prepend: add to beginning. Default: replace.",
          },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: DELETE_NOTE_TOOL,
      description:
        "Move a vault note to the system trash. The file is not permanently deleted and can be recovered. Returns {ok:false, reason:'not-found'} if the file does not exist.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", maxLength: 500, description: "Vault-relative file path." },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
];

export const NOTE_TOOL_DEFINITIONS: ChatToolDefinition[] = [
  {
    type: "function",
    function: {
      name: READ_NOTE_TOOL,
      description:
        "Read the raw content of a vault note by path. For editing only — returned text is NOT citable evidence. To search authoritative sources, use search_index or search_web instead.",
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
      name: SEARCH_NOTES_TOOL,
      description:
        "Find vault notes by keyword match in path or filename. Returns matching paths for editing navigation. Results are NOT evidence and cannot be cited or used to reason about the question.",
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
      name: LIST_NOTES_TOOL,
      description:
        "List vault notes by path prefix or keyword. For editing navigation only — results are not evidence.",
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
      name: GET_ACTIVE_NOTE_TOOL,
      description:
        "Return the currently open Obsidian file path and its raw content. For editing only — not citable evidence. The active note content is already provided as attached context at the start of this conversation.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
];
