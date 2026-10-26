import type { RetrievedChunk, SourceReference } from "@core/model";
import { markdownBracketOccurrences } from "../answerAnalysis";
import type { SubAgentSourcePolicy } from "./sessionModel";
import type { ValidatedJsonValue } from "./stateSnapshot";

export const MAX_IMPORTED_WEB_SOURCES = 10;
export const MAX_IMPORTED_EVIDENCE_ITEMS = 50;
export const MAX_IMPORTED_TEXT_CHARS = 20_000;
export const MAX_IMPORTED_ANSWER_CHARS = 50_000;
export const MAX_REGISTERED_SNIPPET_CHARS = 2_000;
export const UNAVAILABLE_CITATION = "[source unavailable]";

const MAX_TITLE_CHARS = 300;
const MAX_QUERY_CHARS = 500;
const SAFE_ITEM_ID = /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9_:./#?=&%+-]{0,399}$/u;
const DOMAIN_RESOURCE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/u;
const CITATION_LIKE = /^\S{1,200}$/u;

export type SubAgentEvidenceTool =
  "search_index" | "search_web" | "fetch_web_page" | "read_note" | "get_active_note";

export interface SubAgentImportCall {
  callId: string;
  tool: SubAgentEvidenceTool;
  query?: string;
}

/** One child evidence element as the runner reports it, after shape and size checks. */
export interface SubAgentChildEvidence {
  id: string;
  source: SourceReference;
  text: string;
  tool: SubAgentEvidenceTool;
  query?: string;
  collectedAt?: string;
}

/** One admitted child element prepared for the conversation registry under its alias. */
export interface SubAgentImportItem {
  conversationEvidenceId: string;
  subAgentEvidenceId: string;
  chunk: RetrievedChunk;
  calls: readonly SubAgentImportCall[];
  collectedAt: string;
  attempt: number;
  incomplete: boolean;
}

export interface SubAgentEvidenceAdmission {
  admitted: SubAgentChildEvidence[];
  droppedTokens: string[];
  evidenceBudgetExhausted: boolean;
}

const TOOLS: readonly SubAgentEvidenceTool[] = [
  "search_index",
  "search_web",
  "fetch_web_page",
  "read_note",
  "get_active_note",
];

/** Returns the conversation alias prefix shared by every evidence alias of one import. */
export function subAgentAliasPrefix(importId: string): string {
  return `subagent:${importId}:`;
}

/** Returns the lower-cased domain resources a session may import web evidence from. */
export function subAgentAllowedHosts(resources: readonly string[]): string[] {
  return resources
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => DOMAIN_RESOURCE.test(entry));
}

/**
 * True when the URL belongs to one of the allowed hosts or their subdomains. An empty
 * allow-list permits every host; an unparsable URL is refused.
 */
export function subAgentHostAllowed(url: string, allowedHosts: readonly string[]): boolean {
  if (allowedHosts.length === 0) return true;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/**
 * Parses one untrusted child evidence value into a bounded element with a rebuilt
 * source reference; null when any field is missing, unsafe or oversized.
 */
export function parseSubAgentChildEvidence(
  value: ValidatedJsonValue,
  normalizeUrl: (url: string) => string | null,
): SubAgentChildEvidence | null {
  if (!isRecord(value)) return null;
  const { id, text, tool, query, collectedAt, source } = value;
  if (typeof id !== "string" || !SAFE_ITEM_ID.test(id)) return null;
  if (typeof text !== "string" || text.length > MAX_IMPORTED_TEXT_CHARS) return null;
  if (typeof tool !== "string" || !TOOLS.includes(tool as SubAgentEvidenceTool)) return null;
  if (query !== undefined && (typeof query !== "string" || query.length > MAX_QUERY_CHARS))
    return null;
  if (collectedAt !== undefined && (typeof collectedAt !== "string" || !ISO_TIME.test(collectedAt)))
    return null;
  const reference = parseSource(id, source, text, collectedAt, tool, normalizeUrl);
  if (!reference) return null;
  return {
    id,
    source: reference,
    text,
    tool: tool as SubAgentEvidenceTool,
    ...(query !== undefined ? { query } : {}),
    ...(collectedAt !== undefined ? { collectedAt } : {}),
  };
}

/**
 * Applies the import policy of the former run_subagent tool: web evidence needs search or
 * fetch provenance, an allowed host and a place under the ten-source cap; index and note
 * evidence needs its own provenance and a path inside the session's granted scope. Web
 * sources beyond the parent's remaining capacity are dropped and reported as exhausted.
 */
export function admitSubAgentEvidence(
  items: readonly SubAgentChildEvidence[],
  allowedHosts: readonly string[],
  policy: SubAgentSourcePolicy,
  webCapacity = Number.POSITIVE_INFINITY,
): SubAgentEvidenceAdmission {
  const admitted: SubAgentChildEvidence[] = [];
  const droppedTokens: string[] = [];
  let webSources = 0;
  let evidenceBudgetExhausted = false;
  for (const item of items) {
    const overCapacity = item.source.kind === "web" && webSources >= webCapacity;
    evidenceBudgetExhausted ||= overCapacity;
    const allowed =
      item.source.kind === "web"
        ? !overCapacity &&
          (item.tool === "search_web" || item.tool === "fetch_web_page") &&
          webSources < MAX_IMPORTED_WEB_SOURCES &&
          subAgentHostAllowed(item.source.url, allowedHosts)
        : item.tool !== "search_web" &&
          item.tool !== "fetch_web_page" &&
          pathAllowed(policy, item.source.path);
    if (!allowed || admitted.length >= MAX_IMPORTED_EVIDENCE_ITEMS) {
      droppedTokens.push(
        item.id,
        ...(item.source.kind === "web" ? [`url:${item.source.url}`] : []),
      );
      continue;
    }
    if (item.source.kind === "web") webSources += 1;
    admitted.push(item);
  }
  return { admitted, droppedTokens, evidenceBudgetExhausted };
}

/**
 * Rewrites child citation tokens to their conversation aliases, keeps the aliases of the
 * same import and replaces every other citation-like bracket token, such as a dropped
 * child handle or a parent source ID, with an unavailable marker.
 */
export function rewriteSubAgentCitations(
  text: string,
  replacements: ReadonlyMap<string, string>,
  aliases: ReadonlySet<string>,
): string {
  const occurrences = markdownBracketOccurrences(text, new Set(replacements.keys()));
  let result = "";
  let copiedUpTo = 0;
  for (const { label, index, length } of occurrences) {
    const alias = replacements.get(label);
    const replacement =
      alias !== undefined
        ? `[${alias}]`
        : aliases.has(label) || !CITATION_LIKE.test(label)
          ? text.slice(index, index + length)
          : UNAVAILABLE_CITATION;
    result += text.slice(copiedUpTo, index) + replacement;
    copiedUpTo = index + length;
  }
  return result + text.slice(copiedUpTo);
}

/** Lists the citation-like bracket labels of a text that are not aliases of the given set. */
export function unresolvedSubAgentCitations(text: string, aliases: ReadonlySet<string>): string[] {
  return markdownBracketOccurrences(text, aliases)
    .map(({ label }) => label)
    .filter((label) => CITATION_LIKE.test(label) && !aliases.has(label));
}

/**
 * Reads prepared import items back from stored JSON. Each source is rebuilt with the same
 * checks as fresh child evidence, calls must name known tools, and every alias must carry
 * the import's alias prefix; null when any item is malformed or oversized.
 */
export function readSubAgentImportItems(
  values: readonly ValidatedJsonValue[],
  aliasPrefix: string,
  normalizeUrl: (url: string) => string | null,
): SubAgentImportItem[] | null {
  const items: SubAgentImportItem[] = [];
  for (const value of values) {
    const item = readImportItem(value, aliasPrefix, normalizeUrl);
    if (!item) return null;
    items.push(item);
  }
  return items;
}

function readImportItem(
  value: ValidatedJsonValue,
  aliasPrefix: string,
  normalizeUrl: (url: string) => string | null,
): SubAgentImportItem | null {
  if (!isRecord(value) || !isRecord(value.chunk) || !Array.isArray(value.calls)) return null;
  const { conversationEvidenceId: alias, subAgentEvidenceId, collectedAt, attempt } = value;
  const { chunk } = value;
  if (
    typeof alias !== "string" ||
    !alias.startsWith(aliasPrefix) ||
    !SAFE_ITEM_ID.test(alias) ||
    typeof subAgentEvidenceId !== "string" ||
    !SAFE_ITEM_ID.test(subAgentEvidenceId) ||
    typeof collectedAt !== "string" ||
    !ISO_TIME.test(collectedAt) ||
    typeof attempt !== "number" ||
    !Number.isSafeInteger(attempt) ||
    attempt < 0 ||
    typeof value.incomplete !== "boolean" ||
    chunk.id !== alias ||
    typeof chunk.text !== "string" ||
    chunk.text.length > MAX_IMPORTED_TEXT_CHARS ||
    typeof chunk.contentHash !== "string" ||
    !SAFE_ITEM_ID.test(chunk.contentHash)
  ) {
    return null;
  }
  const calls = readCalls(value.calls);
  const tool = calls?.[0]?.tool;
  const source = tool
    ? parseSource(alias, chunk.source, chunk.text, collectedAt, tool, normalizeUrl)
    : null;
  if (!calls || !source) return null;
  return {
    conversationEvidenceId: alias,
    subAgentEvidenceId,
    chunk: { id: alias, source, text: chunk.text, contentHash: chunk.contentHash, score: 1 },
    calls,
    collectedAt,
    attempt,
    incomplete: value.incomplete,
  };
}

function readCalls(values: readonly ValidatedJsonValue[]): SubAgentImportCall[] | null {
  const calls: SubAgentImportCall[] = [];
  for (const call of values) {
    if (
      !isRecord(call) ||
      typeof call.callId !== "string" ||
      !SAFE_ITEM_ID.test(call.callId) ||
      typeof call.tool !== "string" ||
      !TOOLS.includes(call.tool as SubAgentEvidenceTool) ||
      (call.query !== undefined &&
        (typeof call.query !== "string" || call.query.length > MAX_QUERY_CHARS))
    ) {
      return null;
    }
    calls.push({
      callId: call.callId,
      tool: call.tool as SubAgentEvidenceTool,
      ...(typeof call.query === "string" ? { query: call.query } : {}),
    });
  }
  return calls.length > 0 ? calls : null;
}

function pathAllowed(policy: SubAgentSourcePolicy, path: string): boolean {
  if (
    /^[A-Za-z]:/u.test(path) ||
    path.includes("\\") ||
    path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    return false;
  }
  if (policy.indexScope === "all-allowed") return true;
  if (policy.indexScope === "none") return false;
  return policy.contextPaths.some((granted) => path === granted || path.startsWith(`${granted}/`));
}

function parseSource(
  id: string,
  value: ValidatedJsonValue | undefined,
  text: string,
  collectedAt: string | undefined,
  tool: string,
  normalizeUrl: (url: string) => string | null,
): SourceReference | null {
  if (!isRecord(value)) return null;
  const title = value.title;
  if (typeof title !== "string" || title.length > MAX_TITLE_CHARS) return null;
  if (value.kind === "web") {
    const url = typeof value.url === "string" ? normalizeUrl(value.url) : null;
    if (url === null) return null;
    return {
      id,
      kind: "web",
      title,
      url,
      snippet: text.slice(0, MAX_REGISTERED_SNIPPET_CHARS),
      retrievedAt: collectedAt ?? "",
      wasContentFetched: tool === "fetch_web_page",
    };
  }
  const path = value.path;
  if (typeof path !== "string" || path.length === 0 || path.length > MAX_TITLE_CHARS) return null;
  if (value.kind === "markdown") return { id, kind: "markdown", title, path, headingPath: [] };
  if (value.kind === "pdf") {
    const page = value.pageNumber;
    if (typeof page !== "number" || !Number.isSafeInteger(page) || page < 1) return null;
    return { id, kind: "pdf", title, path, pageNumber: page };
  }
  if (value.kind === "document") {
    const format = value.format;
    if (format !== "fb2" && format !== "epub" && format !== "txt" && format !== "docx") return null;
    return { id, kind: "document", title, path, format };
  }
  return null;
}

function isRecord(value: unknown): value is { readonly [key: string]: ValidatedJsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
