import { RetrievalResult } from "../../src/retrieval/RetrievalService";
import {
  Citation,
  RetrievedChunk,
  SourceReference,
  WebSourceReference,
} from "../../src/shared/types";

export function retrieved(
  id: string,
  source: SourceReference,
  text: string,
  score = 0.8,
): RetrievedChunk {
  return { id, source, text, score, contentHash: `hash-${id}` };
}

export function citation(id: string, source: SourceReference, label = source.title): Citation {
  return { id, source, label };
}

export function markdownSource(
  path: string,
  headingPath: string[] = [],
  blockId?: string,
): SourceReference {
  return {
    id: `source-${path}`,
    kind: "markdown",
    title: path,
    path,
    headingPath,
    ...(blockId ? { blockId } : {}),
  };
}

export function pdfSource(path: string, pageNumber: number): SourceReference {
  return {
    id: `source-${path}`,
    kind: "pdf",
    title: path,
    path,
    pageNumber,
  };
}

export function documentSource(
  path: string,
  format: "txt" | "fb2" | "epub" | "docx",
): SourceReference {
  return {
    id: `source-${path}`,
    kind: "document",
    title: path,
    path,
    format,
  };
}

export function webSource(url: string): WebSourceReference {
  return {
    id: `web:${url}`,
    kind: "web",
    title: "Example",
    url,
    snippet: "Example snippet",
    retrievedAt: "2026-05-16T00:00:00.000Z",
    wasContentFetched: true,
  };
}

export function fixedNow(): Date {
  return new Date("2026-05-16T00:00:00.000Z");
}

export function emptyRetrieval(): RetrievalResult {
  return {
    chunks: [],
    citations: [],
    usedFallback: false,
  };
}
