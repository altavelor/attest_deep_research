import { EnrichIndexSources, EnrichmentRunResult } from "@application/use-cases/enrichment";

export interface EnrichmentProfileState {
  status: "idle" | "running" | "done" | "error";
  processed: number;
  total: number;
  extracted: number;
  skipped: number;
  failed: number;
  currentSourcePath?: string;
  phase?: "metadata" | "sections" | "document" | "claims";
  sectionIndex?: number;
  sectionCount?: number;
  errorMessage?: string;
}

export interface EnrichmentProfileControllerOptions {
  createService(
    profileId: string,
    chatModelProfileId: string,
  ): EnrichIndexSources | Promise<EnrichIndexSources>;
  onComplete?(profileId: string, result: EnrichmentRunResult): void | Promise<void>;
  onError?(error: unknown): void;
}

const IDLE_STATE: EnrichmentProfileState = {
  status: "idle",
  processed: 0,
  total: 0,
  extracted: 0,
  skipped: 0,
  failed: 0,
};

export class EnrichmentProfileController {
  private readonly states = new Map<string, EnrichmentProfileState>();
  private readonly listeners = new Set<() => void>();
  private readonly aborts = new Map<string, AbortController>();
  private readonly options: EnrichmentProfileControllerOptions;

  constructor(options: EnrichmentProfileControllerOptions) {
    this.options = options;
  }

  getState(profileId: string): EnrichmentProfileState {
    return this.states.get(profileId) ?? IDLE_STATE;
  }

  isRunning(profileId: string): boolean {
    return this.getState(profileId).status === "running";
  }

  subscribeAll(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async start(
    profileId: string,
    chatModelProfileId: string,
    options: { force?: boolean } = {},
  ): Promise<EnrichmentRunResult | undefined> {
    if (this.isRunning(profileId)) {
      return undefined;
    }
    this.setState(profileId, { ...IDLE_STATE, status: "running" });
    const abort = new AbortController();
    this.aborts.set(profileId, abort);

    try {
      const service = await this.options.createService(profileId, chatModelProfileId);
      const result = await service.run({
        signal: abort.signal,
        force: options.force,
        onProgress: (progress) => {
          const state = this.getState(profileId);
          this.setState(profileId, {
            ...state,
            processed: progress.processed,
            total: progress.total,
            extracted: state.extracted + (progress.status === "extracted" ? 1 : 0),
            skipped: state.skipped + (progress.status === "skipped" ? 1 : 0),
            failed: state.failed + (progress.status === "failed" ? 1 : 0),
            currentSourcePath: progress.status === "working" ? progress.sourcePath : undefined,
            phase: progress.status === "working" ? progress.phase : undefined,
            sectionIndex: progress.status === "working" ? progress.sectionIndex : undefined,
            sectionCount: progress.status === "working" ? progress.sectionCount : undefined,
          });
        },
      });
      await this.options.onComplete?.(profileId, result);
      this.setState(profileId, { ...this.getState(profileId), status: "done" });
      return result;
    } catch (error) {
      this.setState(profileId, {
        ...this.getState(profileId),
        status: "error",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      this.options.onError?.(error);
      return undefined;
    } finally {
      this.aborts.delete(profileId);
    }
  }

  /** Stops the run after the source currently in flight; state becomes "done". */
  cancel(profileId: string): void {
    this.aborts.get(profileId)?.abort();
  }

  private setState(profileId: string, state: EnrichmentProfileState): void {
    this.states.set(profileId, state);
    for (const listener of this.listeners) {
      listener();
    }
  }
}
