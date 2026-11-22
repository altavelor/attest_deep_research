import { markdownCodeRanges } from "../citationTokens";

const ACTIVE_FENCE =
  /^( {0,3}(?:`{3,}|~{3,})[ \t]*)(dataviewjs|dataview|templater|tp|query)\b[^\n]*/iu;
const MARKDOWN_LINK = /\[([^\]\n]*)\]\(([^)\n]*)\)/gu;

/**
 * Neutralises untrusted report Markdown before it becomes a vault note. Outside code, embeds and
 * images become plain links, a link whose target is not http(s) keeps only its text, and HTML tag
 * openers are escaped; fenced blocks of query or script plugins are relabelled `text`.
 */
export function neutralizeExportMarkdown(text: string): string {
  let result = "";
  let copiedUpTo = 0;
  for (const range of markdownCodeRanges(text)) {
    result += neutralizeProse(text.slice(copiedUpTo, range.start));
    result += relabelFence(text.slice(range.start, range.end), range.start, text);
    copiedUpTo = range.end;
  }
  return result + neutralizeProse(text.slice(copiedUpTo));
}

function relabelFence(code: string, start: number, text: string): string {
  if (start > 0 && text[start - 1] !== "\n") return code;
  return code.replace(ACTIVE_FENCE, "$1text");
}

function neutralizeProse(text: string): string {
  return text
    .replace(/!(?=\[)/gu, "")
    .replace(MARKDOWN_LINK, (link, label: string, target: string) =>
      isHttpTarget(target) ? link : label,
    )
    .replace(/<(?=[a-z/!])/giu, "&lt;");
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
