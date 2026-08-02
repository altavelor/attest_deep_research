import { clampText, ImageCandidate, isSafeVaultImagePath } from "@core/media";
import { fileNameFromPath } from "../common";
import { DocxImageExtractor, EpubImageExtractor } from "./archiveImages";
import { Fb2ImageExtractor } from "./fb2Images";
import { MarkdownImageExtractor, TextImageExtractor } from "./markdownImages";
import { PdfImageExtractor } from "./pdfImages";
import type { DocumentImageExtractor, DocumentImageInput, DocumentImageRef } from "./types";

const EXTRACTORS: DocumentImageExtractor[] = [
  new MarkdownImageExtractor(),
  new TextImageExtractor(),
  new PdfImageExtractor(),
  new DocxImageExtractor(),
  new EpubImageExtractor(),
  new Fb2ImageExtractor(),
];

export function supportsDocumentImages(path: string): boolean {
  return EXTRACTORS.some((extractor) => extractor.supports(path));
}

/** Runs the extractor matching the document format; unknown formats yield none. */
export function extractDocumentImages(input: DocumentImageInput): DocumentImageRef[] {
  if (!isSafeVaultImagePath(input.path)) return [];
  const extractor = EXTRACTORS.find((candidate) => candidate.supports(input.path));
  if (!extractor) return [];
  try {
    return extractor.extract(input);
  } catch {
    return [];
  }
}

/**
 * Turns extracted references into per-run candidates attributed to the document.
 * Embedded images keep their locator so the UI can re-extract bytes at render
 * time; linked images point at the vault file directly.
 */
export function documentImageCandidates(
  documentPath: string,
  refs: readonly DocumentImageRef[],
): ImageCandidate[] {
  const label = fileNameFromPath(documentPath);
  return refs.map((ref, index) => ({
    id: `vault:${documentPath}#${ref.locator}`,
    origin: "document" as const,
    format: ref.format,
    vaultSource: {
      documentPath: ref.linkedPath ?? documentPath,
      locator: ref.linkedPath ? `file` : ref.locator,
    },
    alt: clampText(ref.alt, 300) ?? `Image ${index + 1} from ${label}`,
    ...(clampText(ref.caption, 500) ? { caption: clampText(ref.caption, 500)! } : {}),
    sourceUrl: documentPath,
    sourceLabel: label,
    ...(ref.width ? { width: ref.width } : {}),
    ...(ref.height ? { height: ref.height } : {}),
  }));
}
