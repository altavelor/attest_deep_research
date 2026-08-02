import { humanizeToolName } from "@core/agent";

const MAX_LABEL_CHARS = 60;

function truncate(value: string): string {
  return value.length > MAX_LABEL_CHARS ? `${value.slice(0, MAX_LABEL_CHARS)}…` : value;
}

function basename(path: unknown): string {
  if (typeof path !== "string" || !path) return "";
  const last = path.split("/").pop() ?? path;
  return last.endsWith(".md") ? last.slice(0, -3) : last;
}

export function toolCallChainLabel(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "search_index":
    case "search_notes":
    case "search_web":
      return typeof args.query === "string" && args.query
        ? truncate(args.query)
        : humanizeToolName(name);
    case "fetch_web_page": {
      const count = Array.isArray(args.resultIds) ? args.resultIds.length : 0;
      return count > 1 ? `Fetching ${count} pages` : "Fetching page";
    }
    case "list_index_urls":
      return typeof args.sourcePath === "string" && args.sourcePath
        ? `URLs: ${truncate(args.sourcePath)}`
        : "Index URLs";
    case "check_urls":
      return Array.isArray(args.urls) ? `Checking ${args.urls.length} URLs` : "Checking URLs";
    case "run_subagent":
      return typeof args.task === "string" && args.task
        ? `Sub-agent: ${truncate(args.task)}`
        : "Sub-agent";
    case "map_sources":
      return typeof args.question === "string" && args.question
        ? `Fan-out: ${truncate(args.question)}`
        : "Fan-out over sources";
    case "read_note":
      return basename(args.path) || humanizeToolName(name);
    case "get_active_note":
      return "Active note";
    case "list_notes":
      return typeof args.prefix === "string" && args.prefix ? truncate(args.prefix) : "All notes";
    case "create_note":
      return basename(args.path) || humanizeToolName(name);
    case "update_note":
      return basename(args.path) || humanizeToolName(name);
    case "delete_note":
      return basename(args.path) || humanizeToolName(name);
    default:
      return humanizeToolName(name);
  }
}

export function resolveLabelFromResult(name: string, resultJson: string): string | undefined {
  if (name !== "fetch_web_page") return undefined;
  try {
    const parsed = JSON.parse(resultJson) as unknown;
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const value = (parsed as Record<string, unknown>).value as Record<string, unknown> | undefined;
    const pages = value?.pages;
    if (!Array.isArray(pages)) return undefined;
    const hosts = new Set<string>();
    for (const page of pages) {
      const entry = page as Record<string, unknown>;
      if (entry.ok !== true) continue;
      const url = (entry.finalUrl ?? entry.url) as string | undefined;
      if (url) hosts.add(new URL(url).hostname);
    }
    if (hosts.size === 0) return undefined;
    return hosts.size === 1 ? [...hosts][0] : `${hosts.size} hosts`;
  } catch {
    return undefined;
  }
}

export function resolveResultSummary(name: string, resultJson: string): string | undefined {
  try {
    const parsed = JSON.parse(resultJson) as unknown;
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const root = parsed as Record<string, unknown>;

    if (
      name === "search_index" ||
      name === "search_web" ||
      name === "search_notes" ||
      name === "list_index_urls"
    ) {
      const value = root.value as Record<string, unknown> | undefined;
      const results = name === "list_index_urls" ? value?.items : value?.results;
      if (Array.isArray(results)) {
        const noun = name === "list_index_urls" ? "URLs" : "results";
        return results.length === 0 ? `no ${noun}` : `${results.length} ${noun}`;
      }
      return undefined;
    }

    if (name === "check_urls") {
      const value = root.value as Record<string, unknown> | undefined;
      const results = value?.results;
      if (!Array.isArray(results)) return undefined;
      const ok = results.filter((item) => (item as Record<string, unknown>).ok === true).length;
      return `${ok}/${results.length} reachable`;
    }

    if (name === "fetch_web_page") {
      const value = root.value as Record<string, unknown> | undefined;
      const pages = value?.pages;
      if (!Array.isArray(pages)) return undefined;
      let totalChars = 0;
      let failed = 0;
      for (const page of pages) {
        const entry = page as Record<string, unknown>;
        if (entry.ok === true && typeof entry.content === "string") {
          totalChars += entry.content.length;
        } else {
          failed += 1;
        }
      }
      const size = `~${(totalChars / 1024).toFixed(1)} kb`;
      return failed > 0 ? `${size} (${failed} failed)` : size;
    }

    if (name === "read_note" || name === "get_active_note") {
      const value = root.value as Record<string, unknown> | undefined;
      const chunks = value?.chunks;
      if (Array.isArray(chunks)) {
        const totalChars = chunks.reduce((sum, chunk) => {
          return (
            sum +
            (typeof (chunk as Record<string, unknown>).text === "string"
              ? ((chunk as Record<string, unknown>).text as string).length
              : 0)
          );
        }, 0);
        if (totalChars > 0) return `~${(totalChars / 1024).toFixed(1)} kb`;
      }
      return undefined;
    }

    if (name === "create_note" || name === "update_note" || name === "delete_note") {
      return root.ok === true ? "done" : undefined;
    }

    if (name === "run_subagent") {
      const value = root.value as Record<string, unknown> | undefined;
      const sources = typeof value?.sourceCount === "number" ? value.sourceCount : undefined;
      return sources === undefined ? undefined : `${sources} sources`;
    }

    if (name === "map_sources") {
      const value = root.value as Record<string, unknown> | undefined;
      const rows = value?.rows;
      if (Array.isArray(rows)) {
        const failed = rows.filter((row) => (row as Record<string, unknown>).ok === false).length;
        return failed > 0 ? `${rows.length} docs (${failed} failed)` : `${rows.length} docs`;
      }
      return undefined;
    }

    return undefined;
  } catch {
    return undefined;
  }
}
