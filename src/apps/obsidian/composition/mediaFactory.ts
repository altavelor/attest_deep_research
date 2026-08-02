// Composition of the rich-media collaborators: the enabled image-search
// registry and the resolver that turns context documents into image candidates.
// Reading happens only for documents already attached to the request.

import { TFile } from "obsidian";

import { documentImageCandidates, extractDocumentImages } from "@adapters/extractors";
import { createImageSearchSources, StaticImageSearchRegistry } from "@adapters/web";
import { obsidianRequestFetch } from "@apps/obsidian/obsidianFetch";
import type {
  DocumentImageResolver,
  ImageSearchRegistry,
  ResolvedDocumentImage,
} from "@application/ports";
import type { ImageCandidate } from "@core/media";
import { isSafeVaultImagePath } from "@core/media";
import type { CompositionContext } from "./CompositionContext";

const MAX_CONTEXT_DOCUMENTS = 8;

/** Undefined when the user enabled no image resource. */
export function createImageSearchRegistry(
  ctx: CompositionContext,
): ImageSearchRegistry | undefined {
  const sources = createImageSearchSources(ctx.getSettings().webSources, {
    fetch: obsidianRequestFetch,
  });
  return sources.length > 0 ? new StaticImageSearchRegistry(sources) : undefined;
}

/** Extracts image candidates from the documents attached to the request context. */
export function createDocumentImageCandidates(
  ctx: CompositionContext,
): (contextPaths: readonly string[]) => Promise<ImageCandidate[]> {
  return async (contextPaths) => {
    const candidates: ImageCandidate[] = [];
    for (const path of contextPaths.slice(0, MAX_CONTEXT_DOCUMENTS)) {
      const data = await readVaultDocument(ctx, path);
      if (!data) continue;
      candidates.push(...documentImageCandidates(path, extractDocumentImages({ path, data })));
    }
    return candidates;
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
      const match = extractDocumentImages({ path: documentPath, data }).find(
        (ref) => ref.locator === locator,
      );
      return match?.data ? { format: match.format, data: match.data } : undefined;
    },
  };
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
