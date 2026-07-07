// Claim extraction task (SPEC-corpus R7) — the third pass of index enrichment.
// For each content section (references and other low-value headings excluded by
// summarizableSections) the extractor yields short claims tagged with a subject;
// the whole document's claims become one JSONL sidecar. One section failing
// yields no claims for that section rather than failing the document.

import {
  ClaimExtractor,
  DocumentClaim,
  ExtractedClaim,
  SourceDocumentClaims,
} from "@application/ports";
import { ResearchRetriever } from "@application/contracts";
import { SECTION_TEXT_CHARS, summarizableSections } from "./SectionSummaryPlanner";

export const DEFAULT_CLAIM_CONCURRENCY = 3;
const SECTION_CHUNK_LIMIT = 10;

export interface ExtractSourceClaimsDeps {
  retriever: ResearchRetriever;
  extractor: ClaimExtractor;
  sourcePath: string;
  contentHash: string;
  now: () => Date;
  concurrency: number;
  signal?: AbortSignal;
  onProgress?: (progress: { sectionIndex: number; sectionCount: number }) => void;
}

export async function extractSourceClaims(
  deps: ExtractSourceClaimsDeps,
): Promise<SourceDocumentClaims> {
  const outline = await deps.retriever.getIndexSourceOutline?.(deps.sourcePath);
  const sections = summarizableSections(outline);
  const perSection: DocumentClaim[][] = sections.map(() => []);
  const limiter = new Limiter(Math.max(1, deps.concurrency));
  let started = 0;

  await Promise.all(
    sections.map((section, index) =>
      limiter.run(async () => {
        if (deps.signal?.aborted) {
          return;
        }
        started += 1;
        deps.onProgress?.({ sectionIndex: started, sectionCount: sections.length });

        const { chunkId, text } = await loadSectionText(
          deps.retriever,
          deps.sourcePath,
          section.headingPath,
        );
        if (!chunkId || !text) {
          return;
        }
        let extracted: ExtractedClaim[] = [];
        try {
          extracted = await deps.extractor.extract({
            sourcePath: deps.sourcePath,
            chunkId,
            headingPath: section.headingPath,
            text,
          });
        } catch {
          extracted = [];
        }
        perSection[index] = extracted.map((claim, ordinal) => ({
          claimId: `${chunkId}:${ordinal}`,
          chunkId,
          sourcePath: deps.sourcePath,
          subject: claim.subject,
          statement: claim.statement,
          topicKeys: claim.topicKeys,
        }));
      }),
    ),
  );

  return {
    schemaVersion: 1,
    sourcePath: deps.sourcePath,
    contentHash: deps.contentHash,
    claims: perSection.flat(),
    generation: {
      model: deps.extractor.model,
      promptVersion: deps.extractor.promptVersion,
      generatedAt: deps.now().toISOString(),
    },
  };
}

async function loadSectionText(
  retriever: ResearchRetriever,
  sourcePath: string,
  headingPath: string[],
): Promise<{ chunkId: string; text: string }> {
  if (!retriever.listIndexChunks) {
    return { chunkId: "", text: "" };
  }
  const chunks = await retriever.listIndexChunks({
    sourcePath,
    headingPath,
    limit: SECTION_CHUNK_LIMIT,
  });
  if (chunks.items.length === 0) {
    return { chunkId: "", text: "" };
  }
  const chunkId = chunks.items[0].chunkId;

  // Prefer the full contiguous run (previews are 500 chars — too little for claims).
  let text = "";
  if (retriever.readIndexChunk) {
    const read = await retriever.readIndexChunk({
      chunkId,
      before: 0,
      after: chunks.items.length - 1,
      maxChars: SECTION_TEXT_CHARS,
    });
    text = read.chunks
      .map((chunk) => chunk.text)
      .join("\n")
      .slice(0, SECTION_TEXT_CHARS);
  }
  if (!text) {
    text = chunks.items
      .map((item) => item.textPreview)
      .join("\n")
      .slice(0, SECTION_TEXT_CHARS);
  }
  return { chunkId, text };
}

// Bounded-concurrency limiter — the same small semaphore used by the fan-out.
class Limiter {
  private active = 0;
  private readonly queue: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active += 1;
    try {
      return await fn();
    } finally {
      this.active -= 1;
      this.queue.shift()?.();
    }
  }
}
