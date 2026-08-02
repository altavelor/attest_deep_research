// Shared shapes for document image extraction. Extractors return bounded
// descriptors; bytes are produced only when the caller needs to display an
// embedded image and are never persisted.

import type { EligibleImageFormat } from "@core/media";

export interface DocumentImageRef {
  /** Opaque, format-specific pointer, stable for an unchanged document. */
  locator: string;
  format: EligibleImageFormat;
  /** Vault-relative path of a linked file; absent for embedded images. */
  linkedPath?: string;
  alt?: string;
  caption?: string;
  width?: number;
  height?: number;
  /** Compressed bytes of an embedded image; absent for linked files. */
  data?: Uint8Array;
}

export interface DocumentImageInput {
  path: string;
  data: ArrayBuffer | string;
  /** Skips byte extraction when the caller only needs the manifest entries. */
  metadataOnly?: boolean;
}

export interface DocumentImageExtractor {
  supports(path: string): boolean;
  extract(input: DocumentImageInput): DocumentImageRef[];
}
