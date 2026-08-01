import { ContextFileProvider } from "@application/ports";
import { Extractor } from "@application/ports/indexing";
import { ContextDiagnosticSource, ContextSourceRole } from "@core/diagnostics";
import { AttachedFileCoverage, estimateTextTokens } from "@core/research";
import { ExtractedChunk, RetrievedChunk } from "@core/model";

import { estimateChunksTokens, packChunksByBudget } from "./contextBudget";

export type GenerateId = (value: string) => string;

export interface ContextCandidate {
  path: string;
  role: ContextSourceRole;
}

export interface ExplicitContextRequest {
  question: string;
  smallMarkdownCharLimit?: number;
  largeAttachmentsAsReferences?: boolean;
}

export interface ExplicitContextSource {
  chunks: RetrievedChunk[];
  diagnostic: ContextDiagnosticSource;
  coverage: AttachedFileCoverage;
}

const DEFAULT_SMALL_MARKDOWN_CHAR_LIMIT = 10_000;

/** Reads and selects the prompt representation of one explicit context source. */
export class ExplicitContextSourceBuilder {
  constructor(
    private readonly files: ContextFileProvider,
    private readonly extractors: Extractor[],
    private readonly generateId: GenerateId,
  ) {}

  async build(
    candidate: ContextCandidate,
    request: ExplicitContextRequest,
    remainingTokens: number,
  ): Promise<ExplicitContextSource> {
    const extractor = this.extractors.find((item) => item.supports(candidate.path));
    if (!extractor) {
      return this.empty(candidate, "unsupported", "unsupported-file-type");
    }

    let data: ArrayBuffer | string;
    try {
      data = await this.files.readFile(candidate.path);
    } catch {
      return this.empty(candidate, "missing", "read-failed");
    }

    try {
      const modifiedTime = (await this.files.getModifiedTime?.(candidate.path)) ?? 0;
      const size = await this.files.getSize?.(candidate.path);
      const chunks = await extractor.extract({ path: candidate.path, data, modifiedTime, size });
      const selected = selectExplicitChunks(chunks, request, remainingTokens, this.generateId);
      if (selected.coverage === "reference") {
        return {
          chunks: [],
          coverage: "reference",
          diagnostic: {
            path: candidate.path,
            role: candidate.role,
            status: "dropped",
            reason: "referenced-for-tools",
            droppedTokens: estimateChunksTokens(chunks),
          },
        };
      }
      return {
        chunks: selected.chunks,
        coverage: selected.coverage,
        diagnostic: {
          path: candidate.path,
          role: candidate.role,
          status: selected.chunks.length > 0 ? "included" : "dropped",
          chunkCount: selected.chunks.length,
          includedTokens: estimateChunksTokens(selected.chunks),
          droppedTokens: Math.max(
            0,
            estimateChunksTokens(chunks) - estimateChunksTokens(selected.chunks),
          ),
          reason: selected.chunks.length > 0 ? undefined : "context-budget-exceeded",
        },
      };
    } catch {
      return this.empty(candidate, "failed", "extraction-failed");
    }
  }

  private empty(
    candidate: ContextCandidate,
    status: "unsupported" | "missing" | "failed",
    reason: "unsupported-file-type" | "read-failed" | "extraction-failed",
  ): ExplicitContextSource {
    return {
      chunks: [],
      coverage: "omitted",
      diagnostic: { path: candidate.path, role: candidate.role, status, reason },
    };
  }
}

function selectExplicitChunks(
  chunks: ExtractedChunk[],
  request: ExplicitContextRequest,
  remainingTokens: number,
  generateId: GenerateId,
): { chunks: RetrievedChunk[]; coverage: AttachedFileCoverage } {
  if (chunks.length === 0 || remainingTokens <= 0) return { chunks: [], coverage: "omitted" };
  if (isSingleSmallMarkdownFile(chunks, request.smallMarkdownCharLimit)) {
    const combined = combineMarkdownChunks(chunks, generateId);
    if (estimateTextTokens(combined.text) <= remainingTokens) {
      return { chunks: [combined], coverage: "full" };
    }
  }
  if (request.largeAttachmentsAsReferences) return { chunks: [], coverage: "reference" };
  const packed = packChunksByBudget(
    rankChunksForQuestion(chunks, request.question),
    remainingTokens,
  );
  return { chunks: packed, coverage: packed.length === chunks.length ? "full" : "excerpts" };
}

function isSingleSmallMarkdownFile(chunks: ExtractedChunk[], smallLimit?: number): boolean {
  return (
    chunks.every((chunk) => chunk.source.kind === "markdown") &&
    chunks.reduce((total, chunk) => total + chunk.text.length, 0) <=
      (smallLimit ?? DEFAULT_SMALL_MARKDOWN_CHAR_LIMIT)
  );
}

function combineMarkdownChunks(chunks: ExtractedChunk[], generateId: GenerateId): RetrievedChunk {
  const first = chunks[0];
  const text = chunks.map((chunk) => chunk.text).join("\n\n");
  const contentHash = generateId(text);
  const source =
    first.source.kind === "markdown"
      ? {
          ...first.source,
          id: generateId(`${first.source.path}:explicit-full:${contentHash}`),
          title: first.source.path,
          headingPath: [],
          startOffset: undefined,
          endOffset: undefined,
          blockId: undefined,
        }
      : first.source;
  return { id: source.id, source, text, contentHash, score: 1 };
}

function rankChunksForQuestion(chunks: ExtractedChunk[], question: string): RetrievedChunk[] {
  const terms = question
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter((term) => term.length >= 3);
  return chunks
    .map((chunk, index) => {
      const text =
        `${"path" in chunk.source ? chunk.source.path : chunk.source.title} ${chunk.text}`.toLowerCase();
      const score =
        terms.reduce(
          (total, term) => total + (new RegExp(`\\b${escapeRegExp(term)}`, "u").test(text) ? 1 : 0),
          0,
        ) +
        1 / (index + 1_000);
      return { ...chunk, score };
    })
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
