// Map-reduce fan-out over corpus documents (SPEC-corpus R5). For each selected
// source it launches a sub-agent hard-scoped to that document, collects a
// structured stance row, and merges nothing itself — the caller (map_sources
// tool) owns evidence merging into the parent registry. One sub-agent failing
// degrades to an error row rather than aborting the whole fan-out.

import type { ResearchRetriever } from "@application/contracts/research";
import type { RetrievedChunk } from "@core/model";
import type { SubAgentPort, ResearchToolsetOptions } from "@application/research";
import { buildSourceTask, citedEvidenceIds, parseSourceAnswer } from "./mapSourcesParse";
import { MapSourceRow, MapSourcesProgress, MapSourcesResult } from "./types";

export interface MapSourcesDeps {
  runner: SubAgentPort;
  retriever: ResearchRetriever;
  /** Parent turn's toolset context; each sub-agent gets a source-scoped, index-only copy. */
  toolContext: ResearchToolsetOptions;
  /** Concurrent sub-agents (SPEC-corpus R5: ≤ 3–5). */
  maxParallel?: number;
  /** Default fan-out width when the caller gives no explicit source list. */
  defaultMaxSources?: number;
  /** Hard cap on fanned-out sources regardless of the request (cost guard). */
  sourceHardCap?: number;
}

export interface MapSourcesInput {
  question: string;
  sourcePaths?: readonly string[];
  maxSources?: number;
  /** Per-source sub-agent budget (rounds); tighter than the interactive default. */
  perSourceRounds?: number;
  signal?: AbortSignal;
  onProgress?: (event: MapSourcesProgress) => void;
}

const DEFAULT_MAX_PARALLEL = 4;
const DEFAULT_MAX_SOURCES = 8;
const DEFAULT_SOURCE_HARD_CAP = 20;
const DEFAULT_PER_SOURCE_ROUNDS = 6;
const PER_SOURCE_RESULT_CHARS = 20_000;
const SELECTION_SEARCH_LIMIT = 5;

export class MapSources {
  constructor(private readonly deps: MapSourcesDeps) {}

  async run(input: MapSourcesInput): Promise<MapSourcesResult> {
    const hardCap = this.deps.sourceHardCap ?? DEFAULT_SOURCE_HARD_CAP;
    const maxSources = Math.min(
      input.maxSources ?? this.deps.defaultMaxSources ?? DEFAULT_MAX_SOURCES,
      hardCap,
    );

    const selection = await this.selectSources(input, maxSources);
    input.onProgress?.({
      type: "selected",
      sourcePaths: selection.sourcePaths,
      selection: selection.kind,
    });

    const total = selection.sourcePaths.length;
    const rows = new Array<MapSourceRow>(total);
    const limiter = new Limiter(this.deps.maxParallel ?? DEFAULT_MAX_PARALLEL);

    await Promise.all(
      selection.sourcePaths.map((sourcePath, index) =>
        limiter.run(async () => {
          input.onProgress?.({ type: "source-start", sourcePath, index, total });
          const row = await this.mapOne(input, sourcePath);
          rows[index] = row;
          input.onProgress?.({
            type: "source-done",
            sourcePath,
            ok: row.ok,
            index,
            total,
          });
        }),
      ),
    );

    const completed = rows.filter((row) => row.ok).length;
    return {
      question: input.question,
      rows,
      diagnostics: {
        selection: selection.kind,
        requested: total,
        completed,
        failed: total - completed,
      },
    };
  }

  private async mapOne(input: MapSourcesInput, sourcePath: string): Promise<MapSourceRow> {
    try {
      const result = await this.deps.runner.run({
        task: buildSourceTask(input.question, sourcePath),
        toolContext: this.scopedContext(sourcePath),
        budget: {
          maxRounds: input.perSourceRounds ?? DEFAULT_PER_SOURCE_ROUNDS,
          maxResultChars: PER_SOURCE_RESULT_CHARS,
        },
        signal: input.signal,
      });
      const parsed = parseSourceAnswer(result.answerText);
      return {
        sourcePath,
        ok: true,
        stance: parsed.stance,
        keyFindings: parsed.keyFindings,
        evidenceIds: citedEvidenceIds(result.answerText, result.snapshot),
        answer: result.answerText,
        snapshot: result.snapshot,
      };
    } catch (error) {
      return {
        sourcePath,
        ok: false,
        stance: "unclear",
        keyFindings: [],
        evidenceIds: [],
        answer: "",
        error: error instanceof Error ? error.message : String(error),
        snapshot: { evidence: [], citations: [], provenance: [] },
      };
    }
  }

  /** Index-only view locked to one document; no web, no notes, no recursion. */
  private scopedContext(sourcePath: string): ResearchToolsetOptions {
    const base = this.deps.toolContext;
    return {
      ...base,
      availability: {
        ...base.availability,
        searchMode: "indexOnly",
        noteAccess: false,
        activeFileAccess: false,
        noteMutationAccess: false,
      },
      indexSourcePaths: [sourcePath],
      subAgentRunner: undefined,
    };
  }

  private async selectSources(
    input: MapSourcesInput,
    maxSources: number,
  ): Promise<{ sourcePaths: string[]; kind: "explicit" | "relevance" }> {
    const explicit = dedupe((input.sourcePaths ?? []).filter((path) => path.trim().length > 0));
    if (explicit.length > 0) {
      return { sourcePaths: explicit.slice(0, maxSources), kind: "explicit" };
    }

    // No explicit list: cheap relevance pass — rank documents by a single index
    // search over the question, fan out only over the distinct top sources.
    let chunks: RetrievedChunk[] = [];
    try {
      const retrieval = await this.deps.retriever.search(input.question, {
        limit: SELECTION_SEARCH_LIMIT,
        includeWebResults: false,
      });
      chunks = retrieval.chunks;
    } catch {
      chunks = [];
    }
    const paths = dedupe(
      chunks.map(chunkSourcePath).filter((path): path is string => Boolean(path)),
    );
    return { sourcePaths: paths.slice(0, maxSources), kind: "relevance" };
  }
}

function chunkSourcePath(chunk: RetrievedChunk): string | undefined {
  return "path" in chunk.source ? chunk.source.path : undefined;
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}

// Small counting semaphore over a FIFO queue — bounds concurrent sub-agents so a
// wide fan-out does not launch dozens of model sessions at once.
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
