import { markdownCodeRanges } from "../citationTokens";

const CONTAINER = String.raw`(?:[ \t]*(?:>|[-*+]|\d{1,9}[.)])(?=[ \t]|$))*[ \t]*`;
const ACTIVE_FENCE = new RegExp(
  String.raw`^(${CONTAINER}(?:${"`"}{3,}|~{3,})[ \t]*)(dataviewjs|dataview|templater|tp|query)\b`,
  "gimu",
);
const REFERENCE_DEFINITION = new RegExp(
  String.raw`^(${CONTAINER})\[((?:\\.|[^\]\n])+)\]:[ \t]*(<[^>\n]*>|\S*)`,
  "gmu",
);

/**
 * Neutralises untrusted report Markdown before it becomes a vault note. Fences of query and script
 * plugins are relabelled `text` in any container; outside code, embeds and images become plain
 * links, a link or reference definition whose target is not http(s) is broken, and HTML tag
 * openers other than web autolinks are escaped.
 */
export function neutralizeExportMarkdown(text: string): string {
  const relabelled = text.replace(ACTIVE_FENCE, "$1text");
  let result = "";
  let copiedUpTo = 0;
  for (const range of markdownCodeRanges(relabelled)) {
    result += neutralizeProse(relabelled.slice(copiedUpTo, range.start));
    result += relabelled.slice(range.start, range.end);
    copiedUpTo = range.end;
  }
  return result + neutralizeProse(relabelled.slice(copiedUpTo));
}

function neutralizeProse(text: string): string {
  return text
    .replace(REFERENCE_DEFINITION, (line, prefix: string, label: string, target: string) =>
      isHttpTarget(target) ? line : `${prefix}\\[${label}]:${line.slice(line.indexOf("]:") + 2)}`,
    )
    .replace(/!(?=\[)/gu, "")
    .replace(/\]\(([^)\n]*)\)?/gu, (link, target: string) =>
      isHttpTarget(target) ? link : `]\\(${link.slice(2)}`,
    )
    .replace(/<(?!https?:\/\/)(?=[a-z/!])/giu, "&lt;");
}

function isHttpTarget(target: string): boolean {
  const destination =
    target
      .trim()
      .replace(/^<([^>]*)>.*$/u, "$1")
      .split(/\s+/u)[0] ?? "";
  try {
    const url = new URL(destination);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
