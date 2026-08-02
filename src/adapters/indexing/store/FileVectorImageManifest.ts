// Compact per-document image manifest written by a successful full rebuild.
// It stores only what image discovery needs: the document, its content hash, the
// image format, an opaque locator, and bounded display text — never bytes, OS
// paths, or archive member paths beyond the opaque locator itself.

import { isRecord } from "@shared";
import { isNonNegativeInteger } from "@shared";
import { ELIGIBLE_IMAGE_FORMATS, type EligibleImageFormat } from "@core/media";

export const IMAGE_MANIFEST_FILE = "images.jsonl";

/** Index layouts below this version cannot answer index-based image discovery. */
export const REQUIRED_INDEX_VERSION = 1;

export const IMAGE_MANIFEST_LIMITS = {
  maxEntries: 20_000,
  maxAltLength: 300,
  maxCaptionLength: 500,
} as const;

export interface ImageManifestEntry {
  documentPath: string;
  contentHash: string;
  format: EligibleImageFormat;
  locator: string;
  alt?: string;
  caption?: string;
  width?: number;
  height?: number;
}

export function isImageManifestEntry(value: unknown): value is ImageManifestEntry {
  return (
    isRecord(value) &&
    typeof value.documentPath === "string" &&
    value.documentPath.length > 0 &&
    typeof value.contentHash === "string" &&
    typeof value.locator === "string" &&
    value.locator.length > 0 &&
    typeof value.format === "string" &&
    (ELIGIBLE_IMAGE_FORMATS as readonly string[]).includes(value.format) &&
    (value.alt === undefined || typeof value.alt === "string") &&
    (value.caption === undefined || typeof value.caption === "string") &&
    (value.width === undefined || isNonNegativeInteger(value.width)) &&
    (value.height === undefined || isNonNegativeInteger(value.height))
  );
}

/** Trims text fields and drops entries the manifest contract rejects. */
export function normalizeImageManifestEntries(
  entries: readonly ImageManifestEntry[],
): ImageManifestEntry[] {
  const normalized: ImageManifestEntry[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (normalized.length >= IMAGE_MANIFEST_LIMITS.maxEntries) break;
    const candidate: ImageManifestEntry = {
      documentPath: entry.documentPath,
      contentHash: entry.contentHash,
      format: entry.format,
      locator: entry.locator,
      ...(entry.alt ? { alt: entry.alt.slice(0, IMAGE_MANIFEST_LIMITS.maxAltLength) } : {}),
      ...(entry.caption
        ? { caption: entry.caption.slice(0, IMAGE_MANIFEST_LIMITS.maxCaptionLength) }
        : {}),
      ...(entry.width ? { width: Math.floor(entry.width) } : {}),
      ...(entry.height ? { height: Math.floor(entry.height) } : {}),
    };
    if (!isImageManifestEntry(candidate)) continue;
    const key = `${candidate.documentPath}#${candidate.locator}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(candidate);
  }
  return normalized;
}

export function serializeImageManifest(entries: readonly ImageManifestEntry[]): string {
  return normalizeImageManifestEntries(entries)
    .map((entry) => JSON.stringify(entry))
    .join("\n");
}

/** Tolerates partially written or corrupt lines; unreadable entries are skipped. */
export function parseImageManifest(content: string): ImageManifestEntry[] {
  const entries: ImageManifestEntry[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isImageManifestEntry(parsed)) entries.push(parsed);
    } catch {
      continue;
    }
  }
  return entries;
}

/** Absent `indexVersion` means the legacy layout, which is version 0. */
export function manifestIndexVersion(manifest: { indexVersion?: number } | null): number {
  return manifest?.indexVersion ?? 0;
}

export function requiresIndexRebuildForImages(manifest: { indexVersion?: number } | null): boolean {
  return manifestIndexVersion(manifest) < REQUIRED_INDEX_VERSION;
}
