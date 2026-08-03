import { imageFormatFromPath, isSafeVaultImagePath } from "@core/media";
import { IMAGE_EXTRACTION_LIMITS } from "@core/media";
import { readInputText } from "../common";
import type {
  DocumentImageExtractor,
  DocumentImageInput,
  DocumentImageRef,
  LinkedPathResolver,
} from "./types";

const WIKI_EMBED = /!\[\[([^\]|\n]+?)(?:\|([^\]\n]*))?\]\]/g;
const MARKDOWN_IMAGE = /!\[([^\]\n]*)\]\(\s*<?([^\s)>]+)>?(?:\s+"[^"]*")?\s*\)/g;

export interface MarkdownImageOptions {
  documentPath?: string;
  resolveLinkedPath?: LinkedPathResolver;
}

export class MarkdownImageExtractor implements DocumentImageExtractor {
  supports(path: string): boolean {
    return /\.(md|markdown)$/i.test(path);
  }

  extract(input: DocumentImageInput): DocumentImageRef[] {
    if (!this.supports(input.path)) return [];
    return extractMarkdownImageRefs(readInputText(input.data), {
      documentPath: input.path,
      ...(input.resolveLinkedPath ? { resolveLinkedPath: input.resolveLinkedPath } : {}),
    });
  }
}

/** Plain text carries no image references; kept explicit so the format is covered. */
export class TextImageExtractor implements DocumentImageExtractor {
  supports(path: string): boolean {
    return /\.txt$/i.test(path);
  }

  extract(): DocumentImageRef[] {
    return [];
  }
}

/**
 * Pure scan over Markdown source; exported for tests and the index manifest.
 * Link targets are resolved through the host resolver when one is supplied, and
 * otherwise relative to the folder of the containing document.
 */
export function extractMarkdownImageRefs(
  source: string,
  options: MarkdownImageOptions = {},
): DocumentImageRef[] {
  const refs: DocumentImageRef[] = [];
  const seen = new Set<string>();
  const documentPath = options.documentPath ?? "";

  const push = (rawTarget: string, alt: string | undefined, wikiEmbed: boolean): void => {
    if (refs.length >= IMAGE_EXTRACTION_LIMITS.candidatesPerSource) return;
    const target = decodeTarget(rawTarget);
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) return;
    const cleaned = target.split(/[?#]/)[0]?.trim() ?? "";
    if (!cleaned) return;
    const format = imageFormatFromPath(cleaned);
    if (!format) return;

    const linkedPath =
      options.resolveLinkedPath?.(cleaned, documentPath) ??
      resolveAgainstDocument(cleaned, documentPath, wikiEmbed);
    if (!linkedPath || !isSafeVaultImagePath(linkedPath)) return;
    if (seen.has(linkedPath)) return;
    seen.add(linkedPath);
    refs.push({
      locator: `link:${linkedPath}`,
      format,
      linkedPath,
      ...(alt?.trim() ? { alt: alt.trim().slice(0, 300) } : {}),
    });
  };

  for (const match of source.matchAll(WIKI_EMBED)) {
    push(match[1] ?? "", match[2], true);
  }
  for (const match of source.matchAll(MARKDOWN_IMAGE)) {
    push(match[2] ?? "", match[1], false);
  }
  return refs;
}

/**
 * Markdown links are relative to the document, as in CommonMark. A wiki embed
 * without a folder is a vault-wide short link, so it is kept verbatim for the
 * host resolver to interpret; one with a folder is vault-root-relative.
 */
function resolveAgainstDocument(
  target: string,
  documentPath: string,
  wikiEmbed: boolean,
): string | undefined {
  if (target.startsWith("/")) return target.replace(/^\/+/, "");
  if (wikiEmbed) return target.replace(/^\.\//, "");
  const directory = documentPath.split("/").slice(0, -1);
  const segments = [...directory, ...target.split("/")];
  const resolved: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (resolved.length === 0) return undefined;
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }
  return resolved.join("/");
}

function decodeTarget(value: string): string {
  const trimmed = value.trim();
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}
