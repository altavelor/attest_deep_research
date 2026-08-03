import type { EligibleImageFormat, ImageCandidate } from "@core/media";
import type { WebSourceDescriptor } from "@core/web";
import type { DocumentImageManifestEntry } from "./indexing";

export interface ImageSearchOptions {
  limit?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ImageSearchSource {
  descriptor: WebSourceDescriptor;
  searchImages(query: string, options?: ImageSearchOptions): Promise<ImageCandidate[]>;
}

export interface ImageSearchRegistry {
  enabledImageSources(): ImageSearchSource[];
}

export interface DocumentImageManifestReader {
  listDocumentImages(): Promise<DocumentImageManifestEntry[]>;
}

export interface ToolDocumentImageQuery {
  query: string;
  signal?: AbortSignal;
  readPaths?: readonly string[];
}

export interface DocumentImageQuery extends ToolDocumentImageQuery {
  contextPaths: readonly string[];
}

export type DocumentImageDiscovery = (
  request: DocumentImageQuery,
) => Promise<ImageCandidate[]> | ImageCandidate[];

export interface ResolvedDocumentImage {
  format: EligibleImageFormat;
  data: Uint8Array;
}

export interface DocumentImageResolver {
  resolve(
    documentPath: string,
    locator: string,
    contentHash?: string,
  ): Promise<ResolvedDocumentImage | undefined>;
}
