import { stableId } from "./common";
import type { PdfPageText } from "./PdfExtractor";

export interface PdfTextCacheEntry {
  mtime: number;
  size: number;
  textHash: string;
  content: PdfPageText[];
}

export interface PdfTextCacheKey {
  mtime: number;
  size: number;
}

export class PdfTextCache {
  private readonly entries = new Map<string, PdfTextCacheEntry>();

  get(path: string, key: PdfTextCacheKey): PdfTextCacheEntry | null {
    const entry = this.entries.get(path);

    if (!entry || entry.mtime !== key.mtime || entry.size !== key.size) {
      return null;
    }

    return cloneEntry(entry);
  }

  set(path: string, key: PdfTextCacheKey, content: PdfPageText[]): PdfTextCacheEntry {
    const entry: PdfTextCacheEntry = {
      mtime: key.mtime,
      size: key.size,
      textHash: stableId(JSON.stringify(content)),
      content: content.map((page) => ({ ...page })),
    };

    this.entries.set(path, entry);
    return cloneEntry(entry);
  }

  clear(path?: string): void {
    if (path) {
      this.entries.delete(path);
      return;
    }

    this.entries.clear();
  }
}

function cloneEntry(entry: PdfTextCacheEntry): PdfTextCacheEntry {
  return {
    ...entry,
    content: entry.content.map((page) => ({ ...page })),
  };
}
