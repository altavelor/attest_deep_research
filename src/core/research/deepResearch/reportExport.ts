import type { SourceReference } from "@core/model";
import { markdownCitationOccurrences } from "../answerAnalysis";
import type { ResearchReport } from "./types";

export const DEFAULT_RESEARCH_EXPORT_FOLDER = "Attest/Research";
export const MAX_EXPORT_NAME_CHARS = 80;
export const MAX_EXPORT_NAME_ATTEMPTS = 20;
export const FALLBACK_EXPORT_NAME = "Research report";

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/gu;
const HAS_CONTROL_CHAR = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;
const RESERVED_NAME_CHARS = /[\\/:*?"<>|#^[\]]/gu;

export type ExportFolderCheck = { ok: true; folder: string } | { ok: false; reason: string };

export interface ResearchExportInput {
  report: ResearchReport;
  chatId: string;
  researchId: string;
  sources: ReadonlyMap<string, SourceReference>;
}

/**
 * Checks an untrusted vault folder for an export; only the whole value is trimmed and trailing
 * slashes are dropped. It rejects an empty, absolute or backslashed path and any segment that is
 * empty, padded with whitespace, or starts or ends with a dot, which covers `..` and hidden folders.
 */
export function checkExportFolder(value: string): ExportFolderCheck {
  const folder = value.trim().replace(/\/+$/u, "");
  if (folder === "") return { ok: false, reason: "The export folder is empty." };
  if (folder.includes("\\") || folder.startsWith("/") || /^[a-z]:/iu.test(folder)) {
    return { ok: false, reason: `The export folder must be a relative vault path: ${folder}` };
  }
  const segments = folder.split("/");
  if (HAS_CONTROL_CHAR.test(folder) || segments.some(unsafeSegment)) {
    return {
      ok: false,
      reason: `The export folder leaves the vault or enters a hidden folder: ${folder}`,
    };
  }
  return { ok: true, folder };
}

function unsafeSegment(segment: string): boolean {
  return (
    segment === "" ||
    segment.trim() !== segment ||
    segment.startsWith(".") ||
    segment.endsWith(".")
  );
}

/**
 * Builds the note name of an export from an untrusted title and the user's local date. The first
 * attempt has no suffix; attempt n gets ` (n)`.
 */
export function exportFileName(title: string, date: Date, attempt: number): string {
  const cleaned = [...title.replace(CONTROL_CHARS, " ").replace(RESERVED_NAME_CHARS, " ")]
    .join("")
    .replace(/\s+/gu, " ")
    .replace(/^[\s.]+/u, "");
  const bounded = [...cleaned]
    .slice(0, MAX_EXPORT_NAME_CHARS)
    .join("")
    .replace(/[\s.]+$/u, "");
  const name = bounded === "" ? FALLBACK_EXPORT_NAME : bounded;
  const suffix = attempt > 1 ? ` (${attempt})` : "";
  return `${name} - ${localDate(date)}${suffix}.md`;
}

/**
 * Serialises a report as a Markdown note with YAML front matter. A citation token of the
 * conversation registry becomes a wikilink to its vault note or, for an http(s) source, a Markdown
 * link; every other bracket text stays as written.
 */
export function serializeResearchExport(input: ResearchExportInput): string {
  const { report } = input;
  const frontMatter = [
    "---",
    `type: ${yamlString("attest-research-report")}`,
    `chat_id: ${yamlString(input.chatId)}`,
    `research_id: ${yamlString(input.researchId)}`,
    `created: ${yamlString(new Date(report.createdAt).toISOString())}`,
    `quality: ${yamlString(report.quality)}`,
    "---",
  ].join("\n");
  return `${frontMatter}\n\n${linkCitations(report.markdown, input.sources)}\n`;
}

function linkCitations(text: string, sources: ReadonlyMap<string, SourceReference>): string {
  const occurrences = markdownCitationOccurrences(text, new Set(sources.keys()));
  let result = "";
  let copiedUpTo = 0;
  for (const occurrence of occurrences) {
    result += text.slice(copiedUpTo, occurrence.index);
    result += citationMarkup(sources.get(occurrence.label)!);
    copiedUpTo = occurrence.index + occurrence.length;
  }
  return result + text.slice(copiedUpTo);
}

function citationMarkup(source: SourceReference): string {
  const title = inlineText(source.title);
  if (source.kind !== "web") {
    const target = inlineText(source.path.replace(/[[\]|#^]/gu, " "));
    const alias = inlineText(title.replace(/[[\]|]/gu, " "));
    return alias === "" ? `[[${target}]]` : `[[${target}|${alias}]]`;
  }
  const url = httpUrl(source.url);
  const text = (title || source.url).replace(/[\\[\]]/gu, (char) => `\\${char}`);
  if (!url) return inlineText(text);
  return `[${inlineText(text)}](${url.replace(/[()<> ]/gu, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)})`;
}

function httpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function inlineText(value: string): string {
  return value.replace(CONTROL_CHARS, " ").replace(/\s+/gu, " ").trim();
}

function yamlString(value: string): string {
  return JSON.stringify(value.replace(CONTROL_CHARS, " "));
}

function localDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
