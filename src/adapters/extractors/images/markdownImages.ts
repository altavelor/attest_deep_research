// Image references in Markdown and plain text. Markdown supports Obsidian wiki
// embeds and vault-relative image links; plain text has no intrinsic image form,
// so the extractor deliberately returns nothing for `.txt`.

import { imageFormatFromPath, isSafeVaultImagePath } from "@core/media";
import { IMAGE_EXTRACTION_LIMITS } from "@core/media";
import { readInputText } from "../common";
import type { DocumentImageExtractor, DocumentImageInput, DocumentImageRef } from "./types";

const WIKI_EMBED = /!\[\[([^\]|\n]+?)(?:\|([^\]\n]*))?\]\]/g;
const MARKDOWN_IMAGE = /!\[([^\]\n]*)\]\(\s*<?([^\s)>]+)>?(?:\s+"[^"]*")?\s*\)/g;

export class MarkdownImageExtractor implements DocumentImageExtractor {
  supports(path: string): boolean {
    return /\.(md|markdown)$/i.test(path);
  }

  extract(input: DocumentImageInput): DocumentImageRef[] {
    if (!this.supports(input.path)) return [];
    return extractMarkdownImageRefs(readInputText(input.data));
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

/** Pure scan over Markdown source; exported for tests and the index manifest. */
export function extractMarkdownImageRefs(source: string): DocumentImageRef[] {
  const refs: DocumentImageRef[] = [];
  const seen = new Set<string>();

  const push = (rawTarget: string, alt: string | undefined): void => {
    if (refs.length >= IMAGE_EXTRACTION_LIMITS.candidatesPerSource) return;
    const target = decodeTarget(rawTarget);
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) return;
    const linkedPath = target.replace(/^\.\//, "").split(/[?#]/)[0] ?? "";
    if (!isSafeVaultImagePath(linkedPath)) return;
    const format = imageFormatFromPath(linkedPath);
    if (!format) return;
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
    push(match[1] ?? "", match[2]);
  }
  for (const match of source.matchAll(MARKDOWN_IMAGE)) {
    push(match[2] ?? "", match[1]);
  }
  return refs;
}

function decodeTarget(value: string): string {
  const trimmed = value.trim();
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}
