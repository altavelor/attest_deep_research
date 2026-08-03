import { TFile } from "obsidian";

import { documentImageCandidates, extractDocumentImages } from "@adapters/extractors";
import type { DocumentImageRef, LinkedPathResolver } from "@adapters/extractors";
import { hashFileData } from "@adapters/indexing";
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
import {
  ELIGIBLE_IMAGE_FORMATS,
  isSafeVaultImagePath,
  queryTerms,
  vaultFileFingerprint,
} from "@core/media";
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
  return async ({ query, contextPaths, signal, readPaths }) => {
    const candidates: ImageCandidate[] = [];
    const seenDocuments = new Set<string>();

    for (const path of contextPaths.slice(0, MAX_CONTEXT_DOCUMENTS)) {
      if (signal?.aborted) return candidates;
      const data = await readVaultDocument(ctx, path);
      if (!data) continue;
      seenDocuments.add(path);
      candidates.push(
        ...withLinkedFileFingerprints(
          ctx,
          documentImageCandidates(
            path,
            extractDocumentImages({
              path,
              data,
              resolveLinkedPath: createLinkedImagePathResolver(ctx),
            }),
            hashFileData(data),
          ),
        ),
      );
    }

    if (!indexImages || signal?.aborted) return candidates;
    candidates.push(
      ...withLinkedFileFingerprints(
        ctx,
        await indexImageCandidates(indexImages, query, seenDocuments, readPaths ?? []),
      ),
    );
    return candidates;
  };
}

/**
 * Turns manifest records into per-run candidates. Every image of a document the
 * run already read or retrieved is eligible; other documents must match the
 * query text so discovery never turns the whole vault into candidates.
 */
async function indexImageCandidates(
  indexImages: DocumentImageManifestReader,
  query: string,
  excludedDocuments: ReadonlySet<string>,
  readPaths: readonly string[],
): Promise<ImageCandidate[]> {
  let entries: DocumentImageManifestEntry[];
  try {
    entries = await indexImages.listDocumentImages();
  } catch {
    return [];
  }
  if (entries.length === 0) return [];

  const terms = queryTerms(query);
  const readDocuments = new Set(readPaths);
  if (terms.size === 0 && readDocuments.size === 0) return [];

  const byDocument = new Map<string, DocumentImageRef[]>();
  const hashByDocument = new Map<string, string>();
  let matched = 0;
  for (const entry of entries) {
    if (matched >= MAX_INDEX_CANDIDATES) break;
    if (excludedDocuments.has(entry.documentPath)) continue;
    if (!isSafeVaultImagePath(entry.documentPath)) continue;
    if (!readDocuments.has(entry.documentPath) && !matchesQuery(entry, terms)) continue;
    const ref = toDocumentImageRef(entry);
    if (!ref) continue;
    matched += 1;
    if (entry.contentHash) hashByDocument.set(entry.documentPath, entry.contentHash);
    const existing = byDocument.get(entry.documentPath) ?? [];
    existing.push(ref);
    byDocument.set(entry.documentPath, existing);
  }

  const candidates: ImageCandidate[] = [];
  for (const [documentPath, refs] of byDocument) {
    candidates.push(
      ...documentImageCandidates(documentPath, refs, hashByDocument.get(documentPath)),
    );
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
    async resolve(documentPath, locator, contentHash): Promise<ResolvedDocumentImage | undefined> {
      const data = await readVaultDocument(ctx, documentPath);
      if (!data) return undefined;
      if (contentHash && hashFileData(data) !== contentHash) return undefined;
      const match = extractDocumentImages({
        path: documentPath,
        data,
        resolveLinkedPath: createLinkedImagePathResolver(ctx),
      }).find((ref) => ref.locator === locator);
      return match?.data ? { format: match.format, data: match.data } : undefined;
    },
  };
}

/**
 * Stamps linked vault images with a cheap stat fingerprint. Embedded images
 * already carry their document's hash; a linked file is its own asset, so it is
 * fingerprinted separately and verified before it is displayed.
 */
function withLinkedFileFingerprints(
  ctx: CompositionContext,
  candidates: readonly ImageCandidate[],
): ImageCandidate[] {
  return candidates.map((candidate) => {
    const vaultSource = candidate.vaultSource;
    if (!vaultSource || vaultSource.locator !== "file") return candidate;
    const fingerprint = linkedFileFingerprint(ctx, vaultSource.documentPath);
    return fingerprint
      ? { ...candidate, vaultSource: { ...vaultSource, contentHash: fingerprint } }
      : candidate;
  });
}

function linkedFileFingerprint(ctx: CompositionContext, path: string): string | undefined {
  const file = ctx.app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return undefined;
  return vaultFileFingerprint(file.stat.size, file.stat.mtime);
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
