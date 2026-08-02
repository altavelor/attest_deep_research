import { TFile } from "obsidian";

import { documentImageCandidates, extractDocumentImages } from "@adapters/extractors";
import type { DocumentImageRef, LinkedPathResolver } from "@adapters/extractors";
import { createImageSearchSources, StaticImageSearchRegistry } from "@adapters/web";
import { obsidianRequestFetch } from "@apps/obsidian/obsidianFetch";
import type {
  DocumentImageManifestEntry,
  DocumentImageManifestReader,
  DocumentImageQuery,
  DocumentImageResolver,
  ImageSearchRegistry,
  ResolvedDocumentImage,
} from "@application/ports";
import type { EligibleImageFormat, ImageCandidate } from "@core/media";
import { ELIGIBLE_IMAGE_FORMATS, isSafeVaultImagePath, queryTerms } from "@core/media";
import type { CompositionContext } from "./CompositionContext";

const MAX_CONTEXT_DOCUMENTS = 8;
const MAX_INDEX_CANDIDATES = 40;

/** Undefined when the user enabled no image resource. */
export function createImageSearchRegistry(
  ctx: CompositionContext,
): ImageSearchRegistry | undefined {
  const sources = createImageSearchSources(ctx.getSettings().webSources, {
    fetch: obsidianRequestFetch,
  });
  return sources.length > 0 ? new StaticImageSearchRegistry(sources) : undefined;
}

/**
 * Image candidates for a run: the documents attached to the request are read
 * directly, and the rebuilt index contributes documents the user never
 * attached. Index candidates are filtered by the query before any file is read,
 * so discovery stays bounded.
 */
export function createDocumentImageCandidates(
  ctx: CompositionContext,
  indexImages?: DocumentImageManifestReader,
): (request: DocumentImageQuery) => Promise<ImageCandidate[]> {
  return async ({ query, contextPaths, signal }) => {
    const candidates: ImageCandidate[] = [];
    const seenDocuments = new Set<string>();

    for (const path of contextPaths.slice(0, MAX_CONTEXT_DOCUMENTS)) {
      if (signal?.aborted) return candidates;
      const data = await readVaultDocument(ctx, path);
      if (!data) continue;
      seenDocuments.add(path);
      candidates.push(
        ...documentImageCandidates(
          path,
          extractDocumentImages({
            path,
            data,
            resolveLinkedPath: createLinkedImagePathResolver(ctx),
          }),
        ),
      );
    }

    if (!indexImages || signal?.aborted) return candidates;
    candidates.push(...(await indexImageCandidates(indexImages, query, seenDocuments)));
    return candidates;
  };
}

/** Turns manifest records the query plausibly matches into per-run candidates. */
async function indexImageCandidates(
  indexImages: DocumentImageManifestReader,
  query: string,
  excludedDocuments: ReadonlySet<string>,
): Promise<ImageCandidate[]> {
  let entries: DocumentImageManifestEntry[];
  try {
    entries = await indexImages.listDocumentImages();
  } catch {
    return [];
  }
  if (entries.length === 0) return [];

  const terms = queryTerms(query);
  if (terms.size === 0) return [];

  const byDocument = new Map<string, DocumentImageRef[]>();
  let matched = 0;
  for (const entry of entries) {
    if (matched >= MAX_INDEX_CANDIDATES) break;
    if (excludedDocuments.has(entry.documentPath)) continue;
    if (!isSafeVaultImagePath(entry.documentPath)) continue;
    if (!matchesQuery(entry, terms)) continue;
    const ref = toDocumentImageRef(entry);
    if (!ref) continue;
    matched += 1;
    const existing = byDocument.get(entry.documentPath) ?? [];
    existing.push(ref);
    byDocument.set(entry.documentPath, existing);
  }

  const candidates: ImageCandidate[] = [];
  for (const [documentPath, refs] of byDocument) {
    candidates.push(...documentImageCandidates(documentPath, refs));
  }
  return candidates;
}

/** Cheap pre-filter over manifest text so the whole vault is never turned into candidates. */
function matchesQuery(entry: DocumentImageManifestEntry, terms: ReadonlySet<string>): boolean {
  const haystack =
    `${entry.documentPath} ${entry.locator} ${entry.alt ?? ""} ${entry.caption ?? ""}`.toLowerCase();
  for (const term of terms) {
    if (haystack.includes(term)) return true;
  }
  return false;
}

function toDocumentImageRef(entry: DocumentImageManifestEntry): DocumentImageRef | undefined {
  if (!(ELIGIBLE_IMAGE_FORMATS as readonly string[]).includes(entry.format)) return undefined;
  const linkedPath = entry.locator.startsWith("link:") ? entry.locator.slice(5) : undefined;
  if (linkedPath !== undefined && !isSafeVaultImagePath(linkedPath)) return undefined;
  return {
    locator: entry.locator,
    format: entry.format as EligibleImageFormat,
    ...(linkedPath ? { linkedPath } : {}),
    ...(entry.alt ? { alt: entry.alt } : {}),
    ...(entry.caption ? { caption: entry.caption } : {}),
    ...(entry.width ? { width: entry.width } : {}),
    ...(entry.height ? { height: entry.height } : {}),
  };
}

/**
 * Re-reads an embedded image at render time. Missing, moved, or changed
 * documents resolve to undefined so the UI shows the unavailable fallback.
 */
export function createDocumentImageResolver(ctx: CompositionContext): DocumentImageResolver {
  return {
    async resolve(documentPath, locator): Promise<ResolvedDocumentImage | undefined> {
      const data = await readVaultDocument(ctx, documentPath);
      if (!data) return undefined;
      const match = extractDocumentImages({
        path: documentPath,
        data,
        resolveLinkedPath: createLinkedImagePathResolver(ctx),
      }).find((ref) => ref.locator === locator);
      return match?.data ? { format: match.format, data: match.data } : undefined;
    },
  };
}

/** Resolves Markdown and wiki-embed targets exactly as Obsidian links do. */
export function createLinkedImagePathResolver(ctx: CompositionContext): LinkedPathResolver {
  return (target, fromPath) => ctx.app.metadataCache.getFirstLinkpathDest(target, fromPath)?.path;
}

async function readVaultDocument(
  ctx: CompositionContext,
  path: string,
): Promise<ArrayBuffer | undefined> {
  if (!isSafeVaultImagePath(path)) return undefined;
  const file = ctx.app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return undefined;
  try {
    return await ctx.app.vault.readBinary(file);
  } catch {
    return undefined;
  }
}
