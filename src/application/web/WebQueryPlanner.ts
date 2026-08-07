import type { WebSourceDiagnostic, WebSourceSelectionDiagnostics } from "@core/diagnostics";
import {
  classifyWebQuery,
  detectQueryLanguage,
  inferQueryRecency,
  mergeRankedResults,
  selectWebSources,
  WebQueryIntent,
  WebSelectionMode,
  WebSourceCandidate,
  WebSourceExclusion,
  WebSourceExclusionReason,
} from "@core/web";
import {
  SearchProvider,
  SearchProviderResult,
  WebDocumentFetchResult,
  WebPageFetchOptions,
  WebPageFetchResult,
  WebPageMetadataResult,
  WebSearchOptions,
  WebSearchSource,
  WebSourceRegistry,
} from "@application/ports";
import { WebQueryIntentClassifier, WebQueryIntentOrigin } from "./WebQueryIntentClassifier";
import { WebSourceHealthTracker } from "./WebSourceHealthTracker";

export interface WebQueryPlannerOptions {
  registry: WebSourceRegistry;

  fetchDelegate?: SearchProvider;

  intentClassifier?: WebQueryIntentClassifier;

  onSourceError?(sourceId: string, error: unknown): void;

  health?: WebSourceHealthTracker;

  rateLimitCooldownMs?: number;
  now?: () => number;
}

const DEFAULT_DEADLINE_MS = 20_000;
const DEFAULT_PER_SOURCE_LIMIT = 6;
const DEFAULT_MAX_CONCURRENT_SOURCES = 6;

interface PlannedSource {
  source: WebSearchSource;
  diagnostic: WebSourceDiagnostic;
}

interface ResolvedIntent {
  intent?: WebQueryIntent;
  origin?: WebQueryIntentOrigin;
  reason?: string;
}

export class WebQueryPlanner implements SearchProvider {
  private readonly health: WebSourceHealthTracker;

  constructor(private readonly options: WebQueryPlannerOptions) {
    this.health =
      options.health ??
      new WebSourceHealthTracker({
        rateLimitCooldownMs: options.rateLimitCooldownMs,
        now: options.now,
      });
  }

  async search(query: string, options: WebSearchOptions = {}): Promise<SearchProviderResult[]> {
    const mode: WebSelectionMode = options.mode ?? "thinking";
    const language = options.language ?? detectQueryLanguage(query);
    const recency = options.recency ?? inferQueryRecency(query);
    const deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS;
    const perSourceLimit = options.perSourceLimit ?? options.limit ?? DEFAULT_PER_SOURCE_LIMIT;
    const mergedLimit = options.limit ?? Number.POSITIVE_INFINITY;

    const startedAt = this.nowMs();
    const intent = await this.resolveIntent(query, mode, options, deadlineMs);
    const plan = this.planSources({ mode, language }, intent.intent);
    const remainingMs = Math.max(0, deadlineMs - (this.nowMs() - startedAt));

    const report = (deadlineExceeded: boolean, cancelled: boolean): void => {
      options.onSourceSelection?.(
        buildSelectionDiagnostics({
          mode,
          deadlineMs,
          perSourceLimit,
          mergedLimit,
          deadlineExceeded,
          cancelled,
          language,
          intent,
          diagnostics: plan.diagnostics,
        }),
      );
    };

    if (plan.planned.length === 0) {
      report(false, options.signal?.aborted === true);
      return [];
    }

    const searchOptions: WebSearchOptions = {
      ...options,
      language,
      limit: perSourceLimit,
      perSourceLimit,
      ...(recency ? { recency } : {}),
      ...(intent.intent ? { intent: intent.intent } : {}),
    };

    const { lists, deadlineExceeded, cancelled } = await this.collectWithDeadline(
      plan.planned,
      query,
      searchOptions,
      remainingMs,
      options.signal,
      options.maxConcurrentSources ?? DEFAULT_MAX_CONCURRENT_SOURCES,
    );

    const merged = mergeRankedResults(lists, (result) => result.source.url);
    const limited = merged
      .slice(0, mergedLimit)
      .map((result, index) => ({ ...result, rank: index + 1 }));

    countPromptResults(plan.planned, lists, limited);
    report(deadlineExceeded, cancelled);

    return limited;
  }

  searchSourceLabels(query: string, options: WebSearchOptions = {}): readonly string[] {
    const mode: WebSelectionMode = options.mode ?? "thinking";
    const language = options.language ?? detectQueryLanguage(query);
    const intent = options.intent ?? (mode === "instant" ? undefined : classifyWebQuery(query));
    return this.planSources({ mode, language }, intent).planned.map(
      (entry) => entry.source.descriptor.label,
    );
  }

  /**
   * Explicit intent wins; otherwise Thinking asks the classifier and Instant
   * skips classification entirely, since its source pool does not depend on the
   * intent. Classification may spend at most half the web deadline, so the other
   * half is always left for actually querying the sources.
   */
  private async resolveIntent(
    query: string,
    mode: WebSelectionMode,
    options: WebSearchOptions,
    deadlineMs: number,
  ): Promise<ResolvedIntent> {
    if (options.intent) {
      return { intent: options.intent, origin: "explicit" };
    }
    if (mode === "instant") {
      return {};
    }
    const classifier = this.options.intentClassifier;
    if (!classifier) {
      return { intent: classifyWebQuery(query), origin: "heuristic", reason: "no-classifier" };
    }

    const budgetMs = Math.floor(Math.max(0, deadlineMs) / 2);
    if (budgetMs === 0) {
      return { intent: classifyWebQuery(query), origin: "heuristic", reason: "web-deadline" };
    }

    const controller = new AbortController();
    const abortOuter = (): void => controller.abort();
    if (options.signal?.aborted === true) {
      controller.abort();
    } else {
      options.signal?.addEventListener("abort", abortOuter, { once: true });
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const expiry = new Promise<ResolvedIntent>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ intent: classifyWebQuery(query), origin: "heuristic", reason: "web-deadline" });
      }, budgetMs);
    });

    const classified = classifier.classify(query, controller.signal).catch(() => ({
      intent: classifyWebQuery(query),
      origin: "heuristic" as const,
      reason: "classifier-failed",
    }));

    try {
      return await Promise.race([classified, expiry]);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abortOuter);
      controller.abort();
    }
  }

  private planSources(
    context: { mode: WebSelectionMode; language: WebSearchOptions["language"] },
    intent: WebQueryIntent | undefined,
  ): { planned: PlannedSource[]; diagnostics: WebSourceDiagnostic[] } {
    const sources = this.options.registry.enabledSources();
    const byId = new Map(sources.map((source) => [source.descriptor.id, source]));

    const selection = selectWebSources(
      sources.map((source) => ({ descriptor: source.descriptor, activation: source.activation })),
      {
        mode: context.mode,
        ...(intent ? { intent } : {}),
        ...(context.language ? { language: context.language } : {}),
      },
    );

    const diagnostics: WebSourceDiagnostic[] = [];
    const filtered: WebSourceExclusion[] = [];

    for (const exclusion of selection.excluded) {
      if (exclusion.reason === "intent-mismatch") {
        filtered.push(exclusion);
        continue;
      }
      diagnostics.push({
        sourceId: exclusion.sourceId,
        label: byId.get(exclusion.sourceId)?.descriptor.label ?? exclusion.sourceId,
        activation: exclusion.activation,
        outcome: "excluded",
        reason: exclusionReason(exclusion.reason, context.mode, intent),
      });
    }

    const planned: PlannedSource[] = [];
    const admit = (candidates: readonly WebSourceCandidate[]): void => {
      for (const candidate of candidates) {
        const source = byId.get(candidate.descriptor.id);
        if (!source) {
          continue;
        }
        const issue = this.health.getIssue(candidate.descriptor.id);
        if (issue) {
          diagnostics.push({
            sourceId: candidate.descriptor.id,
            label: candidate.descriptor.label,
            activation: candidate.activation,
            outcome: "health-skipped",
            reason: issue.reason,
          });
          continue;
        }
        const diagnostic: WebSourceDiagnostic = {
          sourceId: candidate.descriptor.id,
          label: candidate.descriptor.label,
          activation: candidate.activation,
          outcome: "deadline-exceeded",
          queryOrder: planned.length + 1,
        };
        planned.push({ source, diagnostic });
        diagnostics.push(diagnostic);
      }
    };

    admit(selection.ordered);

    if (planned.length === 0 && filtered.length > 0) {
      admit(
        filtered.flatMap((exclusion) => {
          const source = byId.get(exclusion.sourceId);
          return source
            ? [{ descriptor: source.descriptor, activation: exclusion.activation }]
            : [];
        }),
      );
      return { planned, diagnostics };
    }

    for (const exclusion of filtered) {
      diagnostics.push({
        sourceId: exclusion.sourceId,
        label: byId.get(exclusion.sourceId)?.descriptor.label ?? exclusion.sourceId,
        activation: exclusion.activation,
        outcome: "intent-filtered",
        reason: exclusionReason(exclusion.reason, context.mode, intent),
      });
    }

    return { planned, diagnostics };
  }

  /**
   * Queries the planned sources with bounded concurrency until the deadline
   * passes; latecomers are abandoned rather than awaited. Result lists keep the
   * planned order, so the merge does not depend on who answered first.
   */
  private async collectWithDeadline(
    planned: readonly PlannedSource[],
    query: string,
    searchOptions: WebSearchOptions,
    deadlineMs: number,
    signal: AbortSignal | undefined,
    maxConcurrent: number,
  ): Promise<{
    lists: SearchProviderResult[][];
    deadlineExceeded: boolean;
    cancelled: boolean;
  }> {
    const lists: SearchProviderResult[][] = planned.map(() => []);
    const controller = new AbortController();
    let cancelledByCaller = signal?.aborted === true;
    const abortOuter = (): void => {
      cancelledByCaller = true;
      controller.abort();
    };
    if (cancelledByCaller) {
      controller.abort();
    } else {
      signal?.addEventListener("abort", abortOuter, { once: true });
    }

    let expired = deadlineMs <= 0;
    if (expired) {
      controller.abort();
    }
    let releaseDeadline: () => void = () => {};
    const deadlineReached = new Promise<void>((resolve) => {
      releaseDeadline = resolve;
    });
    const timer = setTimeout(
      () => {
        expired = true;
        controller.abort();
        releaseDeadline();
      },
      Math.max(0, deadlineMs),
    );

    let next = 0;
    const startedAt = this.nowMs();

    const worker = async (): Promise<void> => {
      while (!expired && !controller.signal.aborted) {
        const index = next++;
        if (index >= planned.length) {
          return;
        }
        const entry = planned[index];
        const sourceStartedAt = this.nowMs();
        try {
          const results = await entry.source.search(query, {
            ...searchOptions,
            signal: controller.signal,
          });
          if (expired) {
            return;
          }
          lists[index] = results;
          entry.diagnostic.outcome = "queried";
          entry.diagnostic.returnedResults = results.length;
          entry.diagnostic.promptResults = 0;
          entry.diagnostic.durationMs = this.nowMs() - sourceStartedAt;
          this.health.reportSuccess(entry.source.descriptor.id);
        } catch (error) {
          this.health.reportFailure(entry.source.descriptor.id, error);
          if (expired || controller.signal.aborted) {
            return;
          }
          entry.diagnostic.outcome = "failed";
          entry.diagnostic.reason = sourceErrorReason(error);
          entry.diagnostic.durationMs = this.nowMs() - sourceStartedAt;
          this.options.onSourceError?.(entry.source.descriptor.id, error);
        }
      }
    };

    const workerCount = Math.max(1, Math.min(maxConcurrent, planned.length));
    const workers = Array.from({ length: workerCount }, () => worker());

    try {
      await Promise.race([Promise.all(workers), deadlineReached]);
    } finally {
      clearTimeout(timer);
      releaseDeadline();
      signal?.removeEventListener("abort", abortOuter);
      controller.abort();
    }

    const cancelled = cancelledByCaller && !expired;
    const elapsed = this.nowMs() - startedAt;
    let deadlineExceeded = false;
    for (const entry of planned) {
      if (entry.diagnostic.outcome !== "deadline-exceeded") {
        continue;
      }
      entry.diagnostic.durationMs = elapsed;
      if (cancelled) {
        entry.diagnostic.outcome = "cancelled";
      } else {
        deadlineExceeded = true;
      }
    }

    return { lists, deadlineExceeded, cancelled };
  }

  private nowMs(): number {
    return this.options.now?.() ?? Date.now();
  }

  async fetchPage(url: string, options?: WebPageFetchOptions): Promise<WebPageFetchResult> {
    const delegate = this.requireFetchDelegate();
    if (!delegate?.fetchPage) {
      return fetchUnavailable();
    }
    return delegate.fetchPage(url, options);
  }

  async fetchMetadata(url: string, options?: WebPageFetchOptions): Promise<WebPageMetadataResult> {
    const delegate = this.requireFetchDelegate();
    if (!delegate?.fetchMetadata) {
      return fetchUnavailable();
    }
    return delegate.fetchMetadata(url, options);
  }

  async fetchDocument(url: string, options?: WebPageFetchOptions): Promise<WebDocumentFetchResult> {
    const delegate = this.requireFetchDelegate();
    if (!delegate?.fetchDocument) {
      return fetchUnavailable();
    }
    return delegate.fetchDocument(url, options);
  }

  private requireFetchDelegate(): SearchProvider | undefined {
    return this.options.fetchDelegate;
  }
}

function countPromptResults(
  planned: readonly PlannedSource[],
  lists: readonly SearchProviderResult[][],
  kept: readonly SearchProviderResult[],
): void {
  const keptUrls = new Set(kept.map((result) => result.source.url));
  planned.forEach((entry, index) => {
    if (entry.diagnostic.outcome !== "queried") {
      return;
    }
    entry.diagnostic.promptResults = lists[index].filter((result) =>
      keptUrls.has(result.source.url),
    ).length;
  });
}

function buildSelectionDiagnostics(input: {
  mode: WebSelectionMode;
  deadlineMs: number;
  perSourceLimit: number;
  mergedLimit: number;
  deadlineExceeded: boolean;
  cancelled: boolean;
  language: string;
  intent: ResolvedIntent;
  diagnostics: WebSourceDiagnostic[];
}): WebSourceSelectionDiagnostics {
  return {
    mode: input.mode,
    deadlineMs: input.deadlineMs,
    perSourceLimit: input.perSourceLimit,
    ...(Number.isFinite(input.mergedLimit) ? { mergedLimit: input.mergedLimit } : {}),
    deadlineExceeded: input.deadlineExceeded,
    cancelled: input.cancelled,
    language: input.language,
    ...(input.intent.intent ? { intent: input.intent.intent } : {}),
    ...(input.intent.origin ? { intentOrigin: input.intent.origin } : {}),
    ...(input.intent.reason ? { intentReason: input.intent.reason } : {}),
    sources: input.diagnostics,
  };
}

function exclusionReason(
  reason: WebSourceExclusionReason,
  mode: WebSelectionMode,
  intent: WebQueryIntent | undefined,
): string {
  if (reason === "instant-specialized") {
    return `specialized source skipped in ${mode} mode`;
  }
  if (reason === "no-search-capability") {
    return "source does not support search";
  }
  if (reason === "intent-mismatch") {
    return `no signal for intent: ${intent ?? "unknown"}`;
  }
  return intent ? `disabled (intent: ${intent})` : "disabled";
}

function sourceErrorReason(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "search-failed";
}

function fetchUnavailable(): {
  ok: false;
  error: { code: string; message: string; retryable: false };
} {
  return {
    ok: false,
    error: {
      code: "web-fetch-unavailable",
      message: "No page-fetch provider is configured.",
      retryable: false,
    },
  };
}
