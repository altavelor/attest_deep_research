import { ExtractedChunk, Extractor, ExtractorInput } from "../shared/types";
import {
  createDocumentChunks,
  decodeXmlEntities,
  DEFAULT_CHUNK_LENGTH,
  DocumentExtractorOptions,
  extractionFailed,
  normalizePath,
  stripXmlTags,
  ZipArchive,
} from "./common";

interface ManifestItem {
  href: string;
}

export class EpubExtractor implements Extractor {
  private readonly maxChunkLength: number;

  constructor(options: DocumentExtractorOptions = {}) {
    this.maxChunkLength = options.maxChunkLength ?? DEFAULT_CHUNK_LENGTH;
  }

  supports(path: string): boolean {
    return path.toLowerCase().endsWith(".epub");
  }

  async extract(input: ExtractorInput): Promise<ExtractedChunk[]> {
    if (!this.supports(input.path)) {
      return [];
    }

    try {
      const archive = ZipArchive.read(input.data);
      const container = requireEntry(archive, "META-INF/container.xml");
      const packagePath = readRootfilePath(container);
      const packageXml = requireEntry(archive, packagePath);
      const manifest = readManifest(packageXml);
      const spineIds = readSpineIds(packageXml);
      const packageDirectory = packagePath.split("/").slice(0, -1).join("/");
      const text = spineIds
        .map((id) => manifest.get(id))
        .filter((item): item is ManifestItem => item !== undefined)
        .map((item) => joinZipPath(packageDirectory, decodeXmlEntities(item.href)))
        .map((path) => stripXmlTags(requireEntry(archive, path)))
        .join("\n\n");

      if (!text.trim()) {
        throw new Error("EPUB spine text was not found.");
      }

      return createDocumentChunks({
        path: normalizePath(input.path),
        format: "epub",
        text,
        maxChunkLength: this.maxChunkLength,
      });
    } catch (error) {
      throw extractionFailed("epub", input.path, error);
    }
  }
}

function requireEntry(archive: ZipArchive, path: string): string {
  const text = archive.text(path);

  if (text === undefined) {
    throw new Error(`Missing ZIP entry: ${path}`);
  }

  return text;
}

function readRootfilePath(containerXml: string): string {
  const path = /<rootfile\b[^>]*\bfull-path=["']([^"']+)["']/i.exec(containerXml)?.[1];

  if (!path) {
    throw new Error("EPUB rootfile was not found.");
  }

  return decodeXmlEntities(path);
}

function readManifest(packageXml: string): Map<string, ManifestItem> {
  const manifest = new Map<string, ManifestItem>();

  for (const match of packageXml.matchAll(/<item\b([^>]+)>/gi)) {
    const id = readAttribute(match[1], "id");
    const href = readAttribute(match[1], "href");

    if (id && href) {
      manifest.set(id, { href });
    }
  }

  return manifest;
}

function readSpineIds(packageXml: string): string[] {
  return [...packageXml.matchAll(/<itemref\b([^>]+)>/gi)]
    .map((match) => readAttribute(match[1], "idref"))
    .filter((id): id is string => id !== undefined);
}

function readAttribute(value: string, name: string): string | undefined {
  return new RegExp(`\\b${name}=["']([^"']+)["']`, "i").exec(value)?.[1];
}

function joinZipPath(directory: string, path: string): string {
  return [directory, path].filter(Boolean).join("/").replace(/\/+/g, "/");
}
