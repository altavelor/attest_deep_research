import { computeLineDiff, DiffHunk, diffHasChanges } from "@apps/obsidian/ui/shared/lineDiff";

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
  /** Short warning chip next to the tool head (e.g. degraded search mode). */
  badge?: { text: string; tooltip?: string };
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

  if (status === "failed") {
    return {
      intent,
      inCell: argsCell(args),
      outCell: resultJson ? { kind: "code", text: compactJson(resultJson) } : undefined,
    };
  }

  switch (name) {
    case "read_note":
    case "get_active_note":
    case "delete_note":
      return { intent };

    case "create_note": {
      const content = typeof args.content === "string" ? args.content : "";
      return {
        intent,
        outCell: content ? { kind: "text", text: content } : undefined,
      };
    }

    case "update_note": {
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
        outCell: resultJson ? { kind: "code", text: compactJson(resultJson) } : undefined,
        ...(name === "search_index" ? { badge: keywordFallbackBadge(resultJson) } : {}),
      };
  }
}

/**
 * Surfaces degraded index search (semantic path failed, keyword-only ranking)
 * as a warning chip, so silent quality loss is visible outside the raw report.
 */
function keywordFallbackBadge(resultJson?: string): { text: string; tooltip?: string } | undefined {
  if (!resultJson) return undefined;
  try {
    const parsed = JSON.parse(resultJson) as {
      diagnostics?: { usedKeywordFallback?: boolean; semanticError?: string };
    };
    const diagnostics = parsed.diagnostics;
    if (!diagnostics?.usedKeywordFallback && !diagnostics?.semanticError) return undefined;
    return {
      text: "keyword-only",
      tooltip: diagnostics.semanticError
        ? `Semantic (embedding) search failed: ${diagnostics.semanticError}`
        : "Semantic search returned nothing; results ranked by keywords only.",
    };
  } catch {
    return undefined;
  }
}

function argsCell(args: Record<string, unknown>): ToolCell | undefined {
  if (!args || Object.keys(args).length === 0) return undefined;
  return { kind: "code", text: JSON.stringify(args) };
}

function describeIntent(name: string, args: Record<string, unknown>, label: string): string {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  const path = typeof args.path === "string" ? args.path.trim() : "";
  const url = typeof args.url === "string" ? args.url.trim() : "";
  switch (name) {
    case "search_index":
    case "search_notes": {
      const scope = describeSearchScope(args);
      return query ? `Searching the vault for “${query}”${scope}` : `Searching the vault${scope}`;
    }
    case "search_web": {
      const count = typeof args.count === "number" ? ` (top ${args.count})` : "";
      return query ? `Searching the web for “${query}”${count}` : "Searching the web";
    }
    case "fetch_web_page": {
      const target = url || (label && label !== name ? label : "");
      return target ? `Fetching the page at ${hostOf(target)}` : "Fetching web page";
    }
    case "read_note":
      return path ? `Reading the note “${basename(path)}”` : "Reading a note";
    case "get_active_note":
      return "Reading the currently active note";
    case "list_notes": {
      const prefix = typeof args.prefix === "string" ? args.prefix.trim() : "";
      return prefix ? `Listing notes under “${prefix}”` : "Listing all notes in the vault";
    }
    case "create_note": {
      const size = typeof args.content === "string" ? ` (${args.content.length} chars)` : "";
      return path ? `Creating the note “${basename(path)}”${size}` : "Creating a note";
    }
    case "update_note":
      return path ? `Editing the note “${basename(path)}”` : "Editing a note";
    case "delete_note":
      return path ? `Deleting the note “${basename(path)}”` : "Deleting a note";
    case "run_subagent": {
      const task = typeof args.task === "string" ? args.task.trim() : "";
      return task ? `Delegating to a sub-agent: “${truncate(task, 80)}”` : "Running a sub-agent";
    }
    default:
      return label && label !== name ? label : name;
  }
}

function describeSearchScope(args: Record<string, unknown>): string {
  const limit = typeof args.limit === "number" ? args.limit : undefined;
  const prefix = typeof args.prefix === "string" ? args.prefix.trim() : "";
  const parts: string[] = [];
  if (prefix) parts.push(`under “${prefix}”`);
  if (limit !== undefined) parts.push(`top ${limit}`);
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

function hostOf(target: string): string {
  try {
    return new URL(target).hostname || target;
  } catch {
    return target;
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
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

/**
 * Single-line, whitespace-free rendering for the inline Out preview. Keeps the
 * clamped 3-line window information-dense; the pretty, indented payload lives in
 * the detail tab that opens on click.
 */
function compactJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value));
  } catch {
    return value.replace(/\s+/g, " ").trim();
  }
}

function basename(path: string): string {
  const last = path.split("/").pop() ?? path;
  return last.endsWith(".md") ? last.slice(0, -3) : last;
}
