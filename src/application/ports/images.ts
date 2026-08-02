// Application ports for rich answer media: image discovery through external
// providers and re-resolution of images stored inside vault documents.

import type { EligibleImageFormat, ImageCandidate } from "@core/media";
import type { WebSourceDescriptor } from "@core/web";

export interface ImageSearchOptions {
  limit?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** A provider that answers image queries; carries its catalog descriptor. */
export interface ImageSearchSource {
  descriptor: WebSourceDescriptor;
  searchImages(query: string, options?: ImageSearchOptions): Promise<ImageCandidate[]>;
}

export interface ImageSearchRegistry {
  enabledImageSources(): ImageSearchSource[];
}

/** Raw bytes of a document-embedded image, produced only at render time. */
export interface ResolvedDocumentImage {
  format: EligibleImageFormat;
  data: Uint8Array;
}

/**
 * Re-reads an image out of a vault document using the opaque locator stored in
 * the artifact. Returns undefined when the document moved, changed, or no
 * longer contains the referenced image.
 */
export interface DocumentImageResolver {
  resolve(documentPath: string, locator: string): Promise<ResolvedDocumentImage | undefined>;
}
