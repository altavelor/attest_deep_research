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
      return typeof args.query === "string" && args.query ? truncate(args.query) : name;
    case "fetch_web_page":
      return "Fetching page";
    case "read_note":
      return basename(args.path) || name;
    case "get_active_note":
      return "Active note";
    case "list_notes":
      return typeof args.prefix === "string" && args.prefix ? truncate(args.prefix) : "All notes";
    case "create_note":
      return basename(args.path) || name;
    case "update_note":
      return basename(args.path) || name;
    case "delete_note":
      return basename(args.path) || name;
    default:
      return name;
  }
}

export function resolveLabelFromResult(name: string, resultJson: string): string | undefined {
  if (name !== "fetch_web_page") return undefined;
  try {
    const parsed = JSON.parse(resultJson) as unknown;
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const value = (parsed as Record<string, unknown>).value as Record<string, unknown> | undefined;
    const url = (value?.finalUrl ?? value?.url) as string | undefined;
    if (!url) return undefined;
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

export function resolveResultSummary(name: string, resultJson: string): string | undefined {
  try {
    const parsed = JSON.parse(resultJson) as unknown;
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const root = parsed as Record<string, unknown>;

    if (name === "search_index" || name === "search_web" || name === "search_notes") {
      const value = root.value as Record<string, unknown> | undefined;
      const results = value?.results;
      if (Array.isArray(results)) {
        return results.length === 0 ? "no results" : `${results.length} results`;
      }
      return undefined;
    }

    if (name === "fetch_web_page") {
      const value = root.value as Record<string, unknown> | undefined;
      const content = value?.content;
      if (typeof content === "string") {
        return `~${(content.length / 1024).toFixed(1)} kb`;
      }
      return undefined;
    }

    if (name === "read_note" || name === "get_active_note") {
      const value = root.value as Record<string, unknown> | undefined;
      const chunks = value?.chunks;
      if (Array.isArray(chunks)) {
        const totalChars = chunks.reduce((sum, chunk) => {
          return sum + (typeof (chunk as Record<string, unknown>).text === "string"
            ? ((chunk as Record<string, unknown>).text as string).length
            : 0);
        }, 0);
        if (totalChars > 0) return `~${(totalChars / 1024).toFixed(1)} kb`;
      }
      return undefined;
    }

    if (name === "create_note" || name === "update_note" || name === "delete_note") {
      return root.ok === true ? "done" : undefined;
    }

    return undefined;
  } catch {
    return undefined;
  }
}
