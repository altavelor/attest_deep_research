// Resolves an answer image to something an <img> can display. Third-party
// images are hotlinked as-is; vault files resolve to a vault resource path; and
// document-embedded images are re-extracted into a temporary object URL that the
// caller must revoke on rerender or disposal.

import { App, TFile } from "obsidian";

import type { AnswerImage } from "@core/media";
import { isSafeVaultImagePath, mimeTypeForFormat, validateImageUrl } from "@core/media";
import type { DocumentImageResolver } from "@application/ports";

export interface ResolvedImageSource {
  src: string;
  /** Object URLs must be revoked once the element is discarded. */
  revoke?: () => void;
}

export interface ImageSourceResolverOptions {
  app: App;
  documentImages?: DocumentImageResolver;
}

/**
 * Returns undefined when the image cannot be shown — a missing, moved, or
 * unreadable source, or a URL that fails the hotlink policy. The caller then
 * renders the attribution-only fallback card.
 */
export async function resolveAnswerImageSource(
  image: AnswerImage,
  options: ImageSourceResolverOptions,
  preferThumbnail: boolean,
): Promise<ResolvedImageSource | undefined> {
  const remote = preferThumbnail
    ? (image.thumbnailUrl ?? image.fullUrl)
    : (image.fullUrl ?? image.thumbnailUrl);
  if (remote) {
    const checked = validateImageUrl(remote);
    return checked.ok ? { src: checked.url } : undefined;
  }

  const vaultSource = image.vaultSource;
  if (!vaultSource || !isSafeVaultImagePath(vaultSource.documentPath)) return undefined;

  if (vaultSource.locator === "file") {
    const file = options.app.vault.getAbstractFileByPath(vaultSource.documentPath);
    return file instanceof TFile ? { src: options.app.vault.getResourcePath(file) } : undefined;
  }

  const resolved = await options.documentImages?.resolve(
    vaultSource.documentPath,
    vaultSource.locator,
  );
  if (!resolved) return undefined;

  const blob = new Blob([resolved.data as BlobPart], { type: mimeTypeForFormat(resolved.format) });
  const objectUrl = URL.createObjectURL(blob);
  return { src: objectUrl, revoke: () => URL.revokeObjectURL(objectUrl) };
}
