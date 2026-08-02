// Normalized image candidate produced by providers, page extraction, and
// document extraction. Candidates are per-run and never persisted; only the
// answer image derived from one reaches a saved chat.

import { AnswerImage, ARTIFACT_LIMITS } from "./artifacts";
import { EligibleImageFormat, isSafeVaultImagePath, validateImageUrl } from "./imagePolicy";

export type ImageCandidateOrigin = "provider" | "page" | "document";

export interface ImageCandidate {
  /** Per-run handle the model passes to present_image_gallery. */
  id: string;
  origin: ImageCandidateOrigin;
  format?: EligibleImageFormat;
  thumbnailUrl?: string;
  fullUrl?: string;
  vaultSource?: { documentPath: string; locator: string };
  alt: string;
  caption?: string;
  /** Page or file the image is attributed to; always a public URL or vault link. */
  sourceUrl: string;
  sourceLabel: string;
  licenceName?: string;
  licenceUrl?: string;
  /** Only providers that publish per-image licence metadata set this. */
  licensed?: boolean;
  width?: number;
  height?: number;
}

export function clampText(value: string | undefined, maxLength: number): string | undefined {
  const collapsed = value?.replace(/\s+/g, " ").trim();
  if (!collapsed) return undefined;
  return collapsed.length > maxLength ? `${collapsed.slice(0, maxLength - 1)}…` : collapsed;
}

/**
 * Converts a candidate into the persisted answer image, dropping anything the
 * artifact contract forbids. Returns undefined when the candidate has neither a
 * hotlinkable URL nor a contained vault source.
 */
export function toAnswerImage(candidate: ImageCandidate): AnswerImage | undefined {
  const thumbnailUrl = safeUrl(candidate.thumbnailUrl);
  const fullUrl = safeUrl(candidate.fullUrl);
  const vaultSource =
    candidate.vaultSource && isSafeVaultImagePath(candidate.vaultSource.documentPath)
      ? {
          documentPath: candidate.vaultSource.documentPath,
          locator: candidate.vaultSource.locator.slice(0, 512),
        }
      : undefined;
  if (!thumbnailUrl && !fullUrl && !vaultSource) return undefined;

  const sourceUrl = safeUrlOrVaultLink(candidate.sourceUrl, vaultSource?.documentPath);
  if (!sourceUrl) return undefined;

  return {
    id: candidate.id,
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    ...(fullUrl ? { fullUrl } : {}),
    ...(vaultSource ? { vaultSource } : {}),
    alt: clampText(candidate.alt, ARTIFACT_LIMITS.altLength) ?? "",
    ...(clampText(candidate.caption, ARTIFACT_LIMITS.captionLength)
      ? { caption: clampText(candidate.caption, ARTIFACT_LIMITS.captionLength)! }
      : {}),
    sourceUrl,
    sourceLabel: clampText(candidate.sourceLabel, ARTIFACT_LIMITS.titleLength) ?? sourceUrl,
    ...(candidate.licensed && candidate.licenceName
      ? { licenceName: clampText(candidate.licenceName, ARTIFACT_LIMITS.labelLength)! }
      : {}),
    ...(candidate.licensed && safeUrl(candidate.licenceUrl)
      ? { licenceUrl: safeUrl(candidate.licenceUrl)! }
      : {}),
    ...(candidate.licensed ? { licensed: true } : {}),
  };
}

function safeUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const checked = validateImageUrl(value);
  return checked.ok ? checked.url : undefined;
}

/** Attribution targets are pages (any public HTTPS URL) or the vault document itself. */
function safeUrlOrVaultLink(value: string, documentPath: string | undefined): string | undefined {
  const trimmed = value.trim();
  if (documentPath && trimmed === documentPath) return documentPath;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return documentPath;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return documentPath;
  if (url.username || url.password) return documentPath;
  url.hash = "";
  return url.toString().slice(0, ARTIFACT_LIMITS.urlLength);
}
