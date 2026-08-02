import type { EligibleImageFormat } from "@core/media";

export interface DocumentImageRef {
  locator: string;
  format: EligibleImageFormat;
  linkedPath?: string;
  alt?: string;
  caption?: string;
  width?: number;
  height?: number;
  data?: Uint8Array;
}

export interface DocumentImageInput {
  path: string;
  data: ArrayBuffer | string;
  metadataOnly?: boolean;
  resolveLinkedPath?: LinkedPathResolver;
}

export type LinkedPathResolver = (target: string, fromPath: string) => string | undefined;

export interface DocumentImageExtractor {
  supports(path: string): boolean;
  extract(input: DocumentImageInput): DocumentImageRef[];
}
