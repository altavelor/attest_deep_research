// Application ports for rich answer media: image discovery through external
// providers and re-resolution of images stored inside vault documents.

import type { EligibleImageFormat, ImageCandidate } from "@core/media";
import type { WebSourceDescriptor } from "@core/web";
import type { DocumentImageManifestEntry } from "./indexing";

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

/**
 * Reads the per-document image records written by a full rebuild. An index
 * below the required version returns nothing rather than failing.
 */
export interface DocumentImageManifestReader {
  listDocumentImages(): Promise<DocumentImageManifestEntry[]>;
}

/** What the media tool knows when it asks for locally available images. */
export interface ToolDocumentImageQuery {
  query: string;
  signal?: AbortSignal;
}

/** Adds the run's context documents; the strategy supplies them. */
export interface DocumentImageQuery extends ToolDocumentImageQuery {
  contextPaths: readonly string[];
}

export type DocumentImageDiscovery = (
  request: DocumentImageQuery,
) => Promise<ImageCandidate[]> | ImageCandidate[];

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
