import type { ResearchRetriever } from "@application/contracts/research";
import type { RetrievedChunk } from "@core/model";
import type {
  SubAgentPort,
  ResearchToolsetOptions,
  SubAgentTelemetry,
} from "@application/research";
import { buildSourceTask, citedEvidenceIds, parseSourceAnswer } from "./mapSourcesParse";
import { MapSourceRow, MapSourcesProgress, MapSourcesResult } from "./types";

export interface MapSourcesDeps {
  runner: SubAgentPort;
  retriever: ResearchRetriever;

  toolContext: ResearchToolsetOptions;

  maxParallel?: number;

  defaultMaxSources?: number;

  sourceHardCap?: number;
}

export interface MapSourcesInput {
  question: string;
  sourcePaths?: readonly string[];
  maxSources?: number;

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
    const telemetry = new Array<SubAgentTelemetry | undefined>(total);
    const limiter = new Limiter(this.deps.maxParallel ?? DEFAULT_MAX_PARALLEL);

    await Promise.all(
      selection.sourcePaths.map((sourcePath, index) =>
        limiter.run(async () => {
          input.onProgress?.({ type: "source-start", sourcePath, index, total });
          const mapped = await this.mapOne(input, sourcePath);
          rows[index] = mapped.row;
          telemetry[index] = mapped.telemetry;
          input.onProgress?.({
            type: "source-done",
            sourcePath,
            ok: mapped.row.ok,
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
        subAgents: telemetry.filter((entry): entry is SubAgentTelemetry => entry !== undefined),
      },
    };
  }

  private async mapOne(
    input: MapSourcesInput,
    sourcePath: string,
  ): Promise<{ row: MapSourceRow; telemetry?: SubAgentTelemetry }> {
    const startedAt = Date.now();
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
        row: {
          sourcePath,
          ok: true,
          stance: parsed.stance,
          keyFindings: parsed.keyFindings,
          evidenceIds: citedEvidenceIds(result.answerText, result.snapshot),
          answer: result.answerText,
          snapshot: result.snapshot,
        },
        ...(result.telemetry ? { telemetry: result.telemetry } : {}),
      };
    } catch (error) {
      return {
        row: {
          sourcePath,
          ok: false,
          stance: "unclear",
          keyFindings: [],
          evidenceIds: [],
          answer: "",
          error: error instanceof Error ? error.message : String(error),
          snapshot: { evidence: [], citations: [], provenance: [] },
        },
        telemetry: exceptionTelemetry(Date.now() - startedAt, input.signal?.aborted === true),
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

/**
 * Telemetry for a mapped document whose sub-agent threw before reporting its own
 * counters, so a failed mapping still counts as one launch. A run the caller
 * cancelled is reported as cancelled rather than as a failure.
 */
function exceptionTelemetry(durationMs: number, aborted: boolean): SubAgentTelemetry {
  return {
    runId: `map-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    durationMs,
    loopDurationMs: durationMs,
    rounds: 0,
    maxRounds: 0,
    hitRoundLimit: false,
    failureReason: aborted ? "cancelled" : "tool-exception",
    toolCalls: 0,
    duplicateToolCalls: 0,
    searchCalls: 0,
    maxSearches: 0,
    searchBudgetRejections: 0,
    usedSynthesisFallback: false,
    answerChars: 0,
    usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
  };
}
