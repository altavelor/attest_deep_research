import { humanizeToolName, toolIntent } from "@core/agent";
import { computeLineDiff, DiffHunk, diffHasChanges } from "@apps/obsidian/ui/shared/lineDiff";

export type ToolCell =
  | { kind: "code"; text: string }
  | { kind: "text"; text: string }
  | { kind: "diff"; hunks: DiffHunk[] };

export interface ToolCallView {
  /** Human-readable phrase describing what the model is trying to do. */
  intent: string;
  /** Web sites selected for a fetch, displayed as a one-at-a-time animation. */
  fetchTargets: string[];
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
  /** Site names resolved from preceding web-search results while a fetch is pending. */
  fetchTargets?: string[];
  /** Search resources selected by the web query planner. */
  searchSources?: string[];
}

export function describeToolCall(input: ToolCallViewInput): ToolCallView {
  const { name, args = {}, resultJson, status } = input;
  const fetchTargets =
    name === "fetch_web_page" && status === "pending"
      ? unique(input.fetchTargets ?? fetchedPageHosts(resultJson))
      : [];
  const intent = describeIntent(name, args, input.label, fetchTargets.length, input.searchSources);

  if (status === "failed") {
    return {
      intent,
      fetchTargets,
      inCell: argsCell(args),
      outCell: resultJson ? { kind: "code", text: compactJson(resultJson) } : undefined,
    };
  }

  switch (name) {
    case "read_note":
    case "get_active_note":
    case "delete_note":
      return { intent, fetchTargets };

    case "create_note": {
      const content = typeof args.content === "string" ? args.content : "";
      return {
        intent,
        fetchTargets,
        outCell: content ? { kind: "text", text: content } : undefined,
      };
    }

    case "update_note": {
      const diff = noteEditDiff(resultJson);
      return {
        intent,
        fetchTargets,
        outCell: diff ? { kind: "diff", hunks: diff } : undefined,
      };
    }

    default:
      return {
        intent,
        fetchTargets,
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

/**
 * Delegates to the shared presentation catalog; an unregistered tool falls back
 * to its chain label and then to a humanized name, never to raw snake_case.
 */
function describeIntent(
  name: string,
  args: Record<string, unknown>,
  label: string,
  fetchTargetCount: number,
  searchSources?: string[],
): string {
  const intent = toolIntent(name, {
    args,
    fetchTargetCount,
    ...(searchSources ? { searchSources } : {}),
  });
  if (intent) return intent;
  return label && label !== name ? label : humanizeToolName(name);
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function fetchedPageHosts(resultJson?: string): string[] {
  if (!resultJson) return [];
  try {
    const parsed = JSON.parse(resultJson) as { value?: { pages?: unknown } };
    if (!Array.isArray(parsed.value?.pages)) return [];
    const hosts = new Set<string>();
    for (const page of parsed.value.pages) {
      if (typeof page !== "object" || page === null) continue;
      const entry = page as { ok?: unknown; finalUrl?: unknown; url?: unknown };
      const target = typeof entry.finalUrl === "string" ? entry.finalUrl : entry.url;
      if (entry.ok === true && typeof target === "string") hosts.add(hostOf(target));
    }
    return [...hosts];
  } catch {
    return [];
  }
}

function hostOf(target: string): string {
  try {
    return new URL(target).hostname || target;
  } catch {
    return target;
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
