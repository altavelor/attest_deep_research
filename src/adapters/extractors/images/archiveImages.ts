// Image extraction for the zip-based document formats: DOCX (`word/media` plus
// relationship metadata) and EPUB (manifest images referenced from the spine).
// Archive member paths are treated as untrusted: traversal entries and oversized
// members are skipped.

import { imageFormatFromMimeType, imageFormatFromPath } from "@core/media";
import { IMAGE_EXTRACTION_LIMITS } from "@core/media";
import { decodeXmlEntities, ZipArchive } from "../common";
import type { DocumentImageExtractor, DocumentImageInput, DocumentImageRef } from "./types";

export class DocxImageExtractor implements DocumentImageExtractor {
  supports(path: string): boolean {
    return /\.docx$/i.test(path);
  }

  extract(input: DocumentImageInput): DocumentImageRef[] {
    if (!this.supports(input.path)) return [];
    try {
      const archive = ZipArchive.read(input.data);
      return collectArchiveImages(
        archive,
        docxMediaEntries(archive),
        input.metadataOnly === true,
        docxAltText(archive),
      );
    } catch {
      return [];
    }
  }
}

export class EpubImageExtractor implements DocumentImageExtractor {
  supports(path: string): boolean {
    return /\.epub$/i.test(path);
  }

  extract(input: DocumentImageInput): DocumentImageRef[] {
    if (!this.supports(input.path)) return [];
    try {
      const archive = ZipArchive.read(input.data);
      return collectArchiveImages(
        archive,
        epubManifestImages(archive),
        input.metadataOnly === true,
      );
    } catch {
      return [];
    }
  }
}

function collectArchiveImages(
  archive: ZipArchive,
  entries: string[],
  metadataOnly: boolean,
  altByEntry: Map<string, string> = new Map(),
): DocumentImageRef[] {
  const refs: DocumentImageRef[] = [];
  let totalBytes = 0;

  for (const entry of entries) {
    if (refs.length >= IMAGE_EXTRACTION_LIMITS.candidatesPerSource) break;
    if (!isSafeArchiveEntry(entry)) continue;
    const format = imageFormatFromPath(entry);
    if (!format) continue;
    const bytes = archive.bytes(entry);
    if (!bytes || bytes.length === 0) continue;
    if (bytes.length > IMAGE_EXTRACTION_LIMITS.maxEncodedBytes) continue;
    totalBytes += bytes.length;
    if (totalBytes > IMAGE_EXTRACTION_LIMITS.maxTotalEncodedBytes) break;

    refs.push({
      locator: `zip:${entry}`,
      format,
      ...(altByEntry.get(entry) ? { alt: altByEntry.get(entry)! } : {}),
      ...(metadataOnly ? {} : { data: new Uint8Array(bytes) }),
    });
  }
  return refs;
}

function docxMediaEntries(archive: ZipArchive): string[] {
  return boundedNames(archive)
    .filter((name) => name.toLowerCase().startsWith("word/media/"))
    .sort();
}

/**
 * Maps media entries to the alternative text authored in the drawing metadata,
 * following the document relationships when they are present.
 */
function docxAltText(archive: ZipArchive): Map<string, string> {
  const altByEntry = new Map<string, string>();
  const rels = archive.text("word/_rels/document.xml.rels");
  const documentXml = archive.text("word/document.xml");
  if (!rels || !documentXml) return altByEntry;

  const targetById = new Map<string, string>();
  for (const match of rels.matchAll(/<Relationship\b[^>]*>/gi)) {
    const id = attribute(match[0], "Id");
    const target = attribute(match[0], "Target");
    if (id && target) targetById.set(id, joinArchivePath("word", decodeXmlEntities(target)));
  }

  for (const drawing of documentXml.matchAll(/<w:drawing\b[\s\S]{0,4000}?<\/w:drawing>/gi)) {
    const block = drawing[0];
    const embed = /r:embed="([^"]+)"/.exec(block)?.[1];
    const entry = embed ? targetById.get(embed) : undefined;
    if (!entry) continue;
    const docPr = /<wp:docPr\b[^>]*>/i.exec(block)?.[0] ?? "";
    const alt = attribute(docPr, "descr") ?? attribute(docPr, "name");
    if (alt) altByEntry.set(entry, decodeXmlEntities(alt).slice(0, 300));
  }
  return altByEntry;
}

/** EPUB manifest images, restricted to those referenced from spine documents. */
function epubManifestImages(archive: ZipArchive): string[] {
  const container = archive.text("META-INF/container.xml");
  const packagePath = container ? (/full-path="([^"]+)"/.exec(container)?.[1] ?? "") : "";
  const packageXml = packagePath ? archive.text(packagePath) : undefined;
  if (!packageXml) return [];
  const packageDirectory = packagePath.split("/").slice(0, -1).join("/");

  const manifest = new Map<string, { href: string; mediaType: string }>();
  for (const match of packageXml.matchAll(/<item\b[^>]*>/gi)) {
    const id = attribute(match[0], "id");
    const href = attribute(match[0], "href");
    const mediaType = attribute(match[0], "media-type") ?? "";
    if (id && href) manifest.set(id, { href: decodeXmlEntities(href), mediaType });
  }

  const spineHrefs = [...packageXml.matchAll(/<itemref\b[^>]*>/gi)]
    .map((match) => attribute(match[0], "idref"))
    .map((id) => (id ? manifest.get(id)?.href : undefined))
    .filter((href): href is string => href !== undefined)
    .map((href) => joinArchivePath(packageDirectory, href));

  const referenced = new Set<string>();
  for (const spineHref of spineHrefs.slice(0, 200)) {
    const content = archive.text(spineHref);
    if (!content) continue;
    const contentDirectory = spineHref.split("/").slice(0, -1).join("/");
    for (const tag of content.matchAll(/<(?:img|image)\b[^>]*>/gi)) {
      const src =
        attribute(tag[0], "src") ?? attribute(tag[0], "xlink:href") ?? attribute(tag[0], "href");
      if (src) referenced.add(joinArchivePath(contentDirectory, decodeXmlEntities(src)));
    }
  }

  return [...manifest.values()]
    .filter((item) => imageFormatFromMimeType(item.mediaType) !== undefined)
    .map((item) => joinArchivePath(packageDirectory, item.href))
    .filter((entry) => referenced.size === 0 || referenced.has(entry));
}

function boundedNames(archive: ZipArchive): string[] {
  return archive.names().slice(0, IMAGE_EXTRACTION_LIMITS.maxArchiveEntries);
}

function isSafeArchiveEntry(entry: string): boolean {
  if (!entry || entry.startsWith("/") || entry.includes("\\")) return false;
  return !entry.split("/").some((segment) => segment === ".." || segment === "");
}

function joinArchivePath(directory: string, relative: string): string {
  const target = relative.split(/[?#]/)[0] ?? "";
  if (!directory || target.startsWith("/")) return target.replace(/^\//, "");
  const segments = [...directory.split("/"), ...target.split("/")];
  const resolved: string[] = [];
  for (const segment of segments) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") resolved.pop();
    else resolved.push(segment);
  }
  return resolved.join("/");
}

function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name.replace(":", "\\:")}\\s*=\\s*"([^"]*)"`, "i").exec(tag);
  return match?.[1]?.trim() || undefined;
}
