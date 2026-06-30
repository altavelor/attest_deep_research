import { computeLineDiff, DiffHunk, diffHasChanges } from "../shared/lineDiff";

export type ToolCell =
  | { kind: "code"; text: string }
  | { kind: "text"; text: string }
  | { kind: "diff"; hunks: DiffHunk[] };

export interface ToolCallView {
  /** Human-readable phrase describing what the model is trying to do. */
  intent: string;
  /** Top "In" cell — the call arguments. Omitted when not useful. */
  inCell?: ToolCell;
  /** Bottom "Out" cell — the result. Omitted for tools that need no output. */
  outCell?: ToolCell;
}

export interface ToolCallViewInput {
  name: string;
  label: string;
  status: "pending" | "complete" | "failed";
  args?: Record<string, unknown>;
  resultJson?: string;
}

export function describeToolCall(input: ToolCallViewInput): ToolCallView {
  const { name, args = {}, resultJson, status } = input;
  const intent = describeIntent(name, args, input.label);

  // Failed calls always surface the error payload in the Out cell so the user
  // can see why the step did not complete.
  if (status === "failed") {
    return {
      intent,
      inCell: argsCell(args),
      outCell: resultJson ? { kind: "code", text: prettyJson(resultJson) } : undefined,
    };
  }

  switch (name) {
    case "read_note":
    case "get_active_note":
    case "delete_note":
      // Spec: show only which file was read/deleted, no output body.
      return { intent };

    case "create_note": {
      // Spec: show only the text that was added to the created note.
      const content = typeof args.content === "string" ? args.content : "";
      return {
        intent,
        outCell: content ? { kind: "text", text: content } : undefined,
      };
    }

    case "update_note": {
      // Spec: show the diff between the original and the edited note.
      const diff = noteEditDiff(resultJson);
      return {
        intent,
        outCell: diff ? { kind: "diff", hunks: diff } : undefined,
      };
    }

    default:
      return {
        intent,
        inCell: argsCell(args),
        outCell: resultJson ? { kind: "code", text: prettyJson(resultJson) } : undefined,
      };
  }
}

function argsCell(args: Record<string, unknown>): ToolCell | undefined {
  if (!args || Object.keys(args).length === 0) return undefined;
  return { kind: "code", text: JSON.stringify(args, null, 2) };
}

function describeIntent(name: string, args: Record<string, unknown>, label: string): string {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  const path = typeof args.path === "string" ? args.path.trim() : "";
  switch (name) {
    case "search_index":
    case "search_notes":
      return query ? `Searching the vault for “${query}”` : "Searching the vault";
    case "search_web":
      return query ? `Searching the web for “${query}”` : "Searching the web";
    case "fetch_web_page":
      return label && label !== name ? `Fetching ${label}` : "Fetching web page";
    case "read_note":
      return path ? `Reading ${basename(path)}` : "Reading note";
    case "get_active_note":
      return "Reading the active note";
    case "list_notes": {
      const prefix = typeof args.prefix === "string" ? args.prefix.trim() : "";
      return prefix ? `Listing notes under ${prefix}` : "Listing notes";
    }
    case "create_note":
      return path ? `Creating ${basename(path)}` : "Creating note";
    case "update_note":
      return path ? `Editing ${basename(path)}` : "Editing note";
    case "delete_note":
      return path ? `Deleting ${basename(path)}` : "Deleting note";
    default:
      return label && label !== name ? label : name;
  }
}

function noteEditDiff(resultJson?: string): DiffHunk[] | undefined {
  if (!resultJson) return undefined;
  try {
    const parsed = JSON.parse(resultJson) as Record<string, unknown>;
    const before = typeof parsed.before === "string" ? parsed.before : undefined;
    const after = typeof parsed.after === "string" ? parsed.after : undefined;
    if (before === undefined || after === undefined) return undefined;
    const hunks = computeLineDiff(before, after);
    return diffHasChanges(hunks) ? hunks : undefined;
  } catch {
    return undefined;
  }
}

function prettyJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function basename(path: string): string {
  const last = path.split("/").pop() ?? path;
  return last.endsWith(".md") ? last.slice(0, -3) : last;
}
