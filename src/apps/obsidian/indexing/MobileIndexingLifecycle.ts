export interface IndexingVisibilitySource {
  readonly hidden: boolean;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

export interface MobileIndexingLifecycleOptions {
  visibility: IndexingVisibilitySource;
  getBusyProfileId(): string | undefined;
  getState(profileId: string): { status: string };
  pause(profileId: string): void;
  resume(profileId: string): void | Promise<unknown>;
}

/** Pauses mobile indexing while the app is hidden and resumes only the run it paused itself. */
export class MobileIndexingLifecycle {
  private readonly visibility: IndexingVisibilitySource;
  private readonly getBusyProfileId: MobileIndexingLifecycleOptions["getBusyProfileId"];
  private readonly getState: MobileIndexingLifecycleOptions["getState"];
  private readonly pause: MobileIndexingLifecycleOptions["pause"];
  private readonly resume: MobileIndexingLifecycleOptions["resume"];
  private autoPausedProfileId?: string;
  private autoResume?: Promise<unknown>;
  private started = false;
  private disposed = false;

  constructor(options: MobileIndexingLifecycleOptions) {
    this.visibility = options.visibility;
    this.getBusyProfileId = options.getBusyProfileId;
    this.getState = options.getState;
    this.pause = options.pause;
    this.resume = options.resume;
  }

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    this.visibility.addEventListener("visibilitychange", this.handleVisibilityChange);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.started) {
      this.visibility.removeEventListener("visibilitychange", this.handleVisibilityChange);
      this.started = false;
    }
    this.autoPausedProfileId = undefined;
    this.pauseActiveRun();
  }

  private readonly handleVisibilityChange = (): void => {
    if (this.visibility.hidden) {
      this.pauseForHiddenApp();
      return;
    }

    const profileId = this.autoPausedProfileId;
    if (!profileId || this.getState(profileId).status !== "paused" || this.autoResume) return;
    this.autoResume = Promise.resolve(this.resume(profileId))
      .catch(() => undefined)
      .finally(() => {
        this.autoResume = undefined;
        if (this.disposed) {
          this.pauseProfile(profileId);
          return;
        }
        if (this.autoPausedProfileId !== profileId) return;
        if (this.visibility.hidden) {
          this.pauseProfile(profileId);
        } else if (this.getState(profileId).status !== "indexing") {
          this.autoPausedProfileId = undefined;
        }
      });
  };

  private pauseForHiddenApp(): void {
    const profileId = this.autoPausedProfileId;
    if (profileId) {
      if (this.getState(profileId).status === "idle") {
        this.autoPausedProfileId = undefined;
        this.pauseActiveRun(true);
      } else {
        this.pauseProfile(profileId);
      }
      return;
    }
    this.pauseActiveRun(true);
  }

  private pauseProfile(profileId: string): void {
    if (this.getState(profileId).status === "indexing") this.pause(profileId);
  }

  private pauseActiveRun(recordForResume = false): void {
    const profileId = this.getBusyProfileId();
    if (!profileId || this.getState(profileId).status !== "indexing") return;

    this.pause(profileId);
    if (recordForResume) this.autoPausedProfileId = profileId;
  }
}
