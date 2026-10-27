import type { ResearchRetriever } from "@application/contracts/research";
import type { MapSourcesRunContext } from "@application/ports/mapSources";
import type { SubAgentImportedEvidenceResolver } from "@application/ports/subAgent";
import type { SubAgentTelemetry } from "@application/research/subAgentPort";
import type { SubAgentEvidenceTarget } from "@application/research/subAgentResults";
import type { ResearchEvidenceSnapshot } from "@application/sources/evidence";
import type { RetrievedChunk } from "@core/model";
import {
  isSubAgentStateId,
  mapSourcesBatchError,
  mapSourcesBatchState,
  MAX_MAP_SOURCES_ROWS,
  SubAgentSessionFailure,
  type MapSourcesBatchReceipt,
  type MapSourcesBatchRecord,
  type MapSourcesBatchState,
  type SubAgentRunReceipt,
} from "@core/research";
import { sha256Hex } from "@shared";
import { MapSourcesBatchWatcher } from "./batchWatcher";
import { workerTelemetry } from "./batchMatrix";
import { buildSourceTask } from "./mapSourcesParse";
import {
  batchIdOf,
  canonicalSourcePath,
  MapSourcesFailure,
  normalizeMapSourcesInput,
  PER_SOURCE_RESULT_CHARS,
  workerRequestIdOf,
  type MapSourcesInput,
  type NormalizedMapSourcesInput,
} from "./mapSourcesInput";

export interface MapSourcesDeps {
  runner: MapSourcesRunContext["workers"];
  retriever: ResearchRetriever;
  context: Omit<MapSourcesRunContext, "workers">;
  resolver: SubAgentImportedEvidenceResolver;
  evidence?: SubAgentEvidenceTarget;
  defaultMaxSources?: number;
  sourceHardCap?: number;
  indexPaths?: readonly string[];
}

const SELECTION_SEARCH_LIMIT = 5;
const PARENT_GONE_CODES = new Set(["not-authorized", "fenced-delivery"]);

/**
 * Starts a map_sources batch of one parent run and serves its result. Start selects the
 * documents once, stores the batch intent durably before any worker exists, starts one
 * child session per document and returns the receipt once the refs are durable; the matrix
 * is gathered off the call by result signals and read later with getResult.
 */
export class MapSources {
  private readonly watcher: MapSourcesBatchWatcher;
  private readonly starting = new Map<string, Promise<MapSourcesBatchReceipt>>();
  private readonly startErrors = new Map<string, Map<string, string>>();
  private readonly telemetry = new Map<string, SubAgentTelemetry[]>();

  constructor(private readonly deps: MapSourcesDeps) {
    this.watcher = new MapSourcesBatchWatcher({
      ...deps.context,
      workers: deps.runner,
      resolver: deps.resolver,
      startErrors: (batchId) => this.startErrors.get(batchId) ?? new Map(),
    });
  }

  start(input: MapSourcesInput, requestId: string): Promise<MapSourcesBatchReceipt> {
    if (!isSubAgentStateId(requestId)) {
      return Promise.reject(new MapSourcesFailure("invalid-input", "Invalid request id."));
    }
    const batchId = batchIdOf(requestId);
    const running = this.starting.get(batchId);
    if (running) return running;
    const started = this.startBatch(input, requestId, batchId);
    this.starting.set(batchId, started);
    const forget = (): void => void this.starting.delete(batchId);
    started.then(forget, forget);
    return started;
  }

  async getResult(batchId: string): Promise<MapSourcesBatchState> {
    const { batches, parentRunId } = this.deps.context;
    await batches.load();
    const record = batches.get(batchId);
    if (!record || record.parentRunId !== parentRunId) {
      return {
        state: "failed",
        batchId,
        error: {
          code: "unknown-batch",
          message: "No map_sources batch with this id belongs to this run.",
        },
      };
    }
    if (record.state === "completed") await this.importEvidence(record);
    if (record.state === "pending") this.watcher.watch(batchId);
    const counts = this.watcher.counts(batchId);
    return mapSourcesBatchState(record, { completed: counts.done, failed: counts.failed });
  }

  /** Returns the worker telemetry gathered by the last completed result read of a batch. */
  telemetryOf(batchId: string): readonly SubAgentTelemetry[] {
    return this.telemetry.get(batchId) ?? [];
  }

  private async startBatch(
    input: MapSourcesInput,
    requestId: string,
    batchId: string,
  ): Promise<MapSourcesBatchReceipt> {
    const { batches, parentRunId } = this.deps.context;
    const normalized = normalizeMapSourcesInput(
      input,
      this.deps.defaultMaxSources,
      this.deps.sourceHardCap ?? MAX_MAP_SOURCES_ROWS,
    );
    const digest = sha256Hex(
      JSON.stringify([
        normalized.question,
        normalized.sourcePaths,
        normalized.maxSources,
        normalized.perSourceRounds,
      ]),
    );
    await batches.load();
    const existing = batches.get(batchId);
    if (existing) {
      if (
        existing.parentRunId !== parentRunId ||
        existing.requestId !== requestId ||
        existing.normalizedInputDigest !== digest
      ) {
        throw new MapSourcesFailure(
          "idempotency-conflict",
          "This call already started a different fan-out.",
        );
      }
      return this.register(existing, normalized, input.signal);
    }
    const selection = await this.select(normalized);
    if (selection.sourcePaths.length === 0) {
      throw new MapSourcesFailure(
        "map-sources-empty",
        "No documents matched — provide sourcePaths or broaden the question.",
      );
    }
    const record: MapSourcesBatchRecord = {
      batchId,
      parentRunId,
      requestId,
      normalizedInputDigest: digest,
      question: this.deps.context.redact(normalized.question).slice(0, 1_000) || "?",
      createdAt: this.deps.context.now().toISOString(),
      selection: selection.kind,
      sourcePaths: selection.sourcePaths,
      refs: [],
      state: "preparing",
    };
    await batches.put(record, true);
    this.watcher.announce(record);
    return this.register(record, normalized, input.signal);
  }

  private async register(
    record: MapSourcesBatchRecord,
    input: NormalizedMapSourcesInput,
    signal?: AbortSignal,
  ): Promise<MapSourcesBatchReceipt> {
    if (record.state !== "preparing") return this.settledReceipt(record);
    const { batches } = this.deps.context;
    const refs = [...record.refs];
    const errors = this.startErrors.get(record.batchId) ?? new Map<string, string>();
    this.startErrors.set(record.batchId, errors);
    for (const sourcePath of record.sourcePaths) {
      if (refs.some((entry) => entry.sourcePath === sourcePath)) continue;
      if (!(await this.isIndexedDocument(sourcePath))) {
        errors.set(sourcePath, "source-scope-denied");
        continue;
      }
      let receipt: SubAgentRunReceipt;
      try {
        receipt = await this.deps.runner.runSource({
          requestId: workerRequestIdOf(record.batchId, sourcePath),
          task: buildSourceTask(input.question, sourcePath),
          sourcePath,
          maxRounds: input.perSourceRounds,
          maxResultChars: PER_SOURCE_RESULT_CHARS,
          ...(signal ? { signal } : {}),
        });
      } catch (error) {
        const code = error instanceof SubAgentSessionFailure ? error.code : "not-started";
        if (PARENT_GONE_CODES.has(code) || signal?.aborted) {
          await this.stopBatch({ ...record, refs }, "parent-terminal");
        }
        errors.set(sourcePath, code);
        continue;
      }
      refs.push({ sourcePath, ref: { sessionId: receipt.sessionId, runId: receipt.runId } });
      if (!(await batches.put({ ...record, refs: [...refs] }, false))) {
        return this.settledReceipt(batches.get(record.batchId) ?? record);
      }
    }
    const next: MapSourcesBatchRecord =
      refs.length > 0
        ? { ...record, refs, state: "pending" }
        : {
            ...record,
            refs,
            state: "failed",
            error: mapSourcesBatchError("workers-not-started", "No document worker could start."),
          };
    const stored = await batches.put(next, true);
    return this.settledReceipt(stored ? next : (batches.get(record.batchId) ?? next));
  }

  /** Returns the receipt of a registered batch, or throws the stored error of a failed one. */
  private settledReceipt(record: MapSourcesBatchRecord): MapSourcesBatchReceipt {
    if (record.state === "failed" || record.state === "interrupted") {
      const error =
        record.error ?? mapSourcesBatchError("batch-failed", "The batch did not finish.");
      this.watcher.settle(record);
      throw new MapSourcesFailure(error.code, error.message);
    }
    if (record.state === "pending") this.watcher.watch(record.batchId);
    return receiptOf(record);
  }

  /**
   * Checks through the index inventory that a path is one indexed document, never a folder.
   * A retriever without outlines admits the path, since the worker's exact scope still
   * confines its reads to that path.
   */
  private async isIndexedDocument(sourcePath: string): Promise<boolean> {
    const outline = this.deps.retriever.getIndexSourceOutline;
    if (!outline) return true;
    try {
      return (await outline.call(this.deps.retriever, sourcePath)) !== null;
    } catch {
      return false;
    }
  }

  private async stopBatch(record: MapSourcesBatchRecord, code: string): Promise<never> {
    const stopped: MapSourcesBatchRecord = {
      ...record,
      state: "interrupted",
      error: mapSourcesBatchError(code, "The parent run ended before the batch started."),
    };
    await this.deps.context.batches.put(stopped, true);
    this.watcher.settle(stopped);
    throw new MapSourcesFailure(code, "The parent run ended before the batch started.");
  }

  private async importEvidence(record: MapSourcesBatchRecord): Promise<void> {
    const telemetry: SubAgentTelemetry[] = [];
    for (const { sourcePath, ref } of record.refs) {
      try {
        const state = await this.deps.runner.getResult(ref);
        telemetry.push(workerTelemetry(state));
        if (state.state !== "completed") continue;
        const snapshot = await this.deps.resolver.resolve(state.outcome);
        this.deps.evidence?.importRegisteredSnapshot?.(
          attributed(snapshot, record.requestId, sourcePath),
        );
      } catch {
        continue;
      }
    }
    this.telemetry.set(record.batchId, telemetry);
  }

  private async select(
    input: NormalizedMapSourcesInput,
  ): Promise<{ sourcePaths: string[]; kind: "explicit" | "relevance" }> {
    if (input.sourcePaths.length > 0) return { sourcePaths: input.sourcePaths, kind: "explicit" };
    let chunks: RetrievedChunk[] = [];
    try {
      const scope = this.deps.indexPaths ?? [];
      const retrieval = await this.deps.retriever.search(input.question, {
        limit: SELECTION_SEARCH_LIMIT,
        includeWebResults: false,
        ...(scope.length > 0 ? { sourcePaths: [...scope] } : {}),
      });
      chunks = retrieval.chunks;
    } catch {
      chunks = [];
    }
    const paths: string[] = [];
    for (const chunk of chunks) {
      const canonical = "path" in chunk.source ? canonicalSourcePath(chunk.source.path) : null;
      if (canonical && !paths.includes(canonical)) paths.push(canonical);
    }
    return { sourcePaths: paths.slice(0, input.maxSources), kind: "relevance" };
  }
}

function receiptOf(record: MapSourcesBatchRecord): MapSourcesBatchReceipt {
  return {
    batchId: record.batchId,
    requested: record.sourcePaths.length,
    refs: record.refs.map((entry) => ({ ...entry.ref })),
  };
}

/** Attributes resolved row evidence to the original map_sources call, as the matrix cites it. */
function attributed(
  snapshot: ResearchEvidenceSnapshot,
  callId: string,
  sourcePath: string,
): ResearchEvidenceSnapshot {
  return {
    ...snapshot,
    provenance: snapshot.evidence.map((chunk) => ({
      evidenceId: chunk.id,
      calls: [{ callId, query: sourcePath, tool: "search_index" as const }],
    })),
  };
}
