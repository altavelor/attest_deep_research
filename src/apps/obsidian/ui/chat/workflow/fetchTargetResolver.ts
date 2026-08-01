import { ChainItem } from "@core/conversation";

export function fetchTargetsByResultId(chain: ChainItem[]): Map<string, string> {
  const targets = new Map<string, string>();
  for (const item of chain) {
    if (item.kind !== "tool-call" || item.name !== "search_web" || !item.resultJson) continue;
    try {
      const parsed = JSON.parse(item.resultJson) as { value?: { results?: unknown } };
      if (!Array.isArray(parsed.value?.results)) continue;
      for (const result of parsed.value.results) {
        if (typeof result !== "object" || result === null) continue;
        const entry = result as { resultId?: unknown; url?: unknown };
        if (typeof entry.resultId === "string" && typeof entry.url === "string") {
          targets.set(entry.resultId, siteName(entry.url));
        }
      }
    } catch {
      continue;
    }
  }
  return targets;
}

export function fetchTargetsFor(
  item: Extract<ChainItem, { kind: "tool-call" }>,
  targetsById: Map<string, string>,
): string[] | undefined {
  if (item.name !== "fetch_web_page" || !Array.isArray(item.args?.resultIds)) return undefined;
  const targets = item.args.resultIds.flatMap((id) =>
    typeof id === "string" && targetsById.has(id) ? [targetsById.get(id)!] : [],
  );
  return targets.length > 0 ? targets : undefined;
}

function siteName(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
