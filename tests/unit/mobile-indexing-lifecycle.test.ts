import { vi } from "vitest";

import { MobileIndexingLifecycle } from "@apps/obsidian/indexing/MobileIndexingLifecycle";

describe("MobileIndexingLifecycle", () => {
  it("pauses a visible indexing run on hide and resumes only that run on show", () => {
    const visibility = new FakeVisibilitySource();
    let status: "indexing" | "paused" | "idle" = "indexing";
    const pause = vi.fn(() => {
      status = "paused";
    });
    const resume = vi.fn(() => {
      status = "indexing";
    });
    const lifecycle = new MobileIndexingLifecycle({
      visibility,
      getBusyProfileId: () => "profile-a",
      getState: () => ({ status }),
      pause,
      resume,
    });
    lifecycle.start();

    visibility.setHidden(true);
    visibility.emitChange();
    visibility.emitChange();
    expect(pause).toHaveBeenCalledOnce();
    expect(pause).toHaveBeenCalledWith("profile-a");

    visibility.setHidden(false);
    visibility.emitChange();
    visibility.emitChange();
    expect(resume).toHaveBeenCalledOnce();
    expect(resume).toHaveBeenCalledWith("profile-a");
  });

  it("does not auto-resume an indexing run that was already paused manually", () => {
    const visibility = new FakeVisibilitySource();
    const pause = vi.fn();
    const resume = vi.fn();
    const lifecycle = new MobileIndexingLifecycle({
      visibility,
      getBusyProfileId: () => "profile-a",
      getState: () => ({ status: "paused" }),
      pause,
      resume,
    });
    lifecycle.start();

    visibility.setHidden(true);
    visibility.emitChange();
    visibility.setHidden(false);
    visibility.emitChange();

    expect(pause).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
  });

  it("pauses again when the app hides while an auto-resume is pending", async () => {
    const visibility = new FakeVisibilitySource();
    let status: "indexing" | "paused" = "indexing";
    let completeResume: (() => void) | undefined;
    const resume = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          completeResume = () => {
            status = "indexing";
            resolve();
          };
        }),
    );
    const pause = vi.fn(() => {
      status = "paused";
    });
    const lifecycle = new MobileIndexingLifecycle({
      visibility,
      getBusyProfileId: () => "profile-a",
      getState: () => ({ status }),
      pause,
      resume,
    });
    lifecycle.start();

    visibility.setHidden(true);
    visibility.emitChange();
    visibility.setHidden(false);
    visibility.emitChange();
    visibility.setHidden(true);
    visibility.emitChange();
    completeResume?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(resume).toHaveBeenCalledOnce();
    expect(pause).toHaveBeenCalledTimes(2);
    expect(pause).toHaveBeenLastCalledWith("profile-a");
    expect(status).toBe("paused");
  });

  it("registers once and removes its listener when disposed", () => {
    const visibility = new FakeVisibilitySource();
    const lifecycle = new MobileIndexingLifecycle({
      visibility,
      getBusyProfileId: () => undefined,
      getState: () => ({ status: "idle" }),
      pause: vi.fn(),
      resume: vi.fn(),
    });

    lifecycle.start();
    lifecycle.start();
    expect(visibility.listenerCount()).toBe(1);

    lifecycle.dispose();
    lifecycle.dispose();
    expect(visibility.listenerCount()).toBe(0);
  });

  it("pauses an active run during disposal without resuming it later", () => {
    const visibility = new FakeVisibilitySource();
    const pause = vi.fn();
    const resume = vi.fn();
    const lifecycle = new MobileIndexingLifecycle({
      visibility,
      getBusyProfileId: () => "profile-a",
      getState: () => ({ status: "indexing" }),
      pause,
      resume,
    });
    lifecycle.start();

    lifecycle.dispose();
    visibility.setHidden(false);
    visibility.emitChange();

    expect(pause).toHaveBeenCalledOnce();
    expect(pause).toHaveBeenCalledWith("profile-a");
    expect(resume).not.toHaveBeenCalled();
  });
});

class FakeVisibilitySource {
  hidden = false;
  private readonly listeners = new Set<() => void>();

  addEventListener(type: string, listener: () => void): void {
    if (type === "visibilitychange") this.listeners.add(listener);
  }

  removeEventListener(type: string, listener: () => void): void {
    if (type === "visibilitychange") this.listeners.delete(listener);
  }

  setHidden(hidden: boolean): void {
    this.hidden = hidden;
  }

  emitChange(): void {
    for (const listener of this.listeners) listener();
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}
