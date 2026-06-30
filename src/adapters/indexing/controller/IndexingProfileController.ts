import { IndexProfile } from "../store/FileVectorIndexStore";
import { IndexingController, IndexingStateListener } from "./IndexingController";
import { IndexingService, IndexingState } from "../IndexingService";

export interface IndexingProfileControllerOptions {
  getProfile(profileId: string): IndexProfile | undefined;
  createService(profileId: string, onProgress: IndexingStateListener): IndexingService;
  measureIndexSize?(profileId: string): Promise<number | null>;
  onError?(error: unknown): void;
  onComplete?(profileId: string, state: IndexingState): void | Promise<void>;
}

export class IndexingProfileController {
  private readonly controllers = new Map<string, IndexingController>();
  private readonly getProfile: IndexingProfileControllerOptions["getProfile"];
  private readonly createService: IndexingProfileControllerOptions["createService"];
  private readonly measureIndexSize?: IndexingProfileControllerOptions["measureIndexSize"];
  private readonly onError?: IndexingProfileControllerOptions["onError"];
  private readonly onComplete?: IndexingProfileControllerOptions["onComplete"];
  private readonly listeners = new Set<() => void>();

  constructor(options: IndexingProfileControllerOptions) {
    this.getProfile = options.getProfile;
    this.createService = options.createService;
    this.measureIndexSize = options.measureIndexSize;
    this.onError = options.onError;
    this.onComplete = options.onComplete;
  }

  getState(profileId: string): IndexingState {
    const controller = this.controllers.get(profileId);
    if (controller) {
      return controller.getState();
    }

    return createIndexingStateFromProfile(this.getProfile(profileId));
  }

  getBusyProfileId(): string | undefined {
    for (const [profileId, controller] of this.controllers) {
      const status = controller.getState().status;
      if (status === "indexing" || status === "paused") {
        return profileId;
      }
    }

    return undefined;
  }

  subscribe(profileId: string, listener: IndexingStateListener): () => void {
    return this.getController(profileId).subscribe(listener);
  }

  subscribeAll(listener: () => void): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  async start(profileId: string): Promise<IndexingState> {
    this.assertCanRun(profileId);
    return this.runAndRecord(profileId, () => this.getController(profileId).start());
  }

  pause(profileId: string): void {
    this.getController(profileId).pause();
    this.notifyAll();
  }

  async resume(profileId: string): Promise<IndexingState> {
    this.assertCanRun(profileId);
    return this.runAndRecord(profileId, () => this.getController(profileId).resume());
  }

  async rebuild(profileId: string): Promise<IndexingState> {
    this.assertCanRun(profileId);
    return this.runAndRecord(profileId, () => this.getController(profileId).rebuild());
  }

  markStale(profileId: string): void {
    this.getController(profileId).markStale();
    this.notifyAll();
  }

  async refreshIndexSize(profileId: string): Promise<void> {
    await this.getController(profileId).refreshIndexSize();
    this.notifyAll();
  }

  private getController(profileId: string): IndexingController {
    const existing = this.controllers.get(profileId);
    if (existing) {
      return existing;
    }

    const controller = new IndexingController({
      createService: (onProgress) => this.createService(profileId, onProgress),
      measureIndexSize: this.measureIndexSize ? () => this.measureIndexSize!(profileId) : undefined,
      onError: this.onError,
    });
    this.controllers.set(profileId, controller);
    controller.subscribe(() => this.notifyAll());
    return controller;
  }

  private assertCanRun(profileId: string): void {
    const busyProfileId = this.getBusyProfileId();
    if (busyProfileId && busyProfileId !== profileId) {
      throw new Error("Finish or stop the current indexing run before starting another index.");
    }
  }

  private async runAndRecord(
    profileId: string,
    run: () => Promise<IndexingState>,
  ): Promise<IndexingState> {
    const state = await run();
    if (state.lastIndexedAt && state.status !== "paused" && state.status !== "error") {
      await this.onComplete?.(profileId, state);
    }
    this.notifyAll();
    return state;
  }

  private notifyAll(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export function createIndexingStateFromProfile(profile: IndexProfile | undefined): IndexingState {
  return {
    status: profile?.lastIndexedAt ? "idle" : "idle",
    scannedFiles: 0,
    totalFiles: 0,
    progress: 0,
    indexedFiles: profile?.indexedFileCount ?? 0,
    skippedFiles: 0,
    embeddedChunks: 0,
    deferredFiles: 0,
    failedFiles: 0,
    lastIndexedAt: profile?.lastIndexedAt,
    indexSizeBytes: profile?.indexSizeBytes,
    isStale: false,
  };
}
