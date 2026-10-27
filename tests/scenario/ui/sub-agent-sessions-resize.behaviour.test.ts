// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App, Platform } from "../../support/obsidian";
import type { App as ObsidianApp } from "obsidian";

import { createTranslator } from "@adapters/i18n";
import { SubAgentSessionsModal } from "@apps/obsidian/ui/chat/sub-agents";
import { settle } from "../../support/async";
import { installObsidianDomHelpers, resetDom } from "../../support/domHarness";
import { FakeInspectionPort, inspectionSnapshot } from "../../support/subAgentInspection";

const KEY = "attest-sub-agents-modal-size";

function openModal(app: App): SubAgentSessionsModal {
  const port = new FakeInspectionPort();
  const modal = new SubAgentSessionsModal(app as unknown as ObsidianApp, {
    port,
    t: createTranslator("en").t,
    chatTitle: "Chat",
    debug: false,
    direction: "ltr",
    onStopFailedOutside: () => {},
    onClosed: () => {},
  });
  modal.open();
  port.emit(inspectionSnapshot([]));
  return modal;
}

function modalEl(): HTMLElement {
  return document.body.querySelector<HTMLElement>(".attest-sub-agents-modal")!;
}

function handle(edge: "right" | "bottom" | "corner"): HTMLElement {
  return modalEl().querySelector<HTMLElement>(`.attest-sub-agents__resize--${edge}`)!;
}

function size(): string {
  const style = modalEl().style;
  return `${style.getPropertyValue("--attest-sub-agents-width")} x ${style.getPropertyValue("--attest-sub-agents-height")}`;
}

function pointer(
  target: HTMLElement,
  type: string,
  x: number,
  y: number,
  init: PointerEventInit = {},
): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      pointerId: 1,
      button: 0,
      pointerType: "mouse",
      clientX: x,
      clientY: y,
      bubbles: true,
      ...init,
    }),
  );
}

function key(target: HTMLElement, name: string, shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: name,
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

function setWindowWidth(width: number): void {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  window.dispatchEvent(new Event("resize"));
}

const initialWidth = window.innerWidth;

beforeEach(() => {
  installObsidianDomHelpers();
});

afterEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: initialWidth });
  Platform.isMobile = false;
  resetDom();
  vi.restoreAllMocks();
});

describe("sub-agent sessions modal resizing", () => {
  it("R1 exposes accessible handles on desktop and none on mobile", () => {
    const app = new App();
    const modal = openModal(app);
    expect(modalEl().classList.contains("attest-sub-agents-modal--resizable")).toBe(true);
    expect(handle("right").getAttribute("role")).toBe("separator");
    expect(handle("right").getAttribute("aria-orientation")).toBe("vertical");
    expect(handle("bottom").getAttribute("aria-orientation")).toBe("horizontal");
    expect(handle("corner").getAttribute("tabindex")).toBe("0");
    expect(handle("corner").getAttribute("aria-label")).toBe("Resize width and height");
    expect(size()).toBe("680px x 640px");
    expect(handle("right").getAttribute("aria-valuemin")).toBe("352");
    expect(handle("right").getAttribute("aria-valuemax")).toBe("992");
    expect(handle("bottom").getAttribute("aria-valuenow")).toBe("640");
    expect(handle("bottom").getAttribute("aria-valuemax")).toBe("736");
    expect(handle("corner").hasAttribute("aria-valuenow")).toBe(false);
    modal.close();

    Platform.isMobile = true;
    openModal(app);
    expect(modalEl().querySelector(".attest-sub-agents__resize")).toBeNull();
    expect(modalEl().classList.contains("attest-sub-agents-modal--resizable")).toBe(false);
  });

  it("R2 drags symmetrically within the viewport and persists the size on release", () => {
    const app = new App();
    openModal(app);
    pointer(handle("right"), "pointerdown", 500, 300);
    pointer(handle("right"), "pointermove", 540, 900);
    expect(size()).toBe("760px x 640px");
    expect(modalEl().classList.contains("is-resizing")).toBe(true);
    expect(app.loadLocalStorage(KEY)).toBeNull();
    pointer(handle("right"), "pointermove", 2000, 300);
    pointer(handle("right"), "pointerup", 2000, 300);
    expect(size()).toBe("992px x 640px");
    expect(app.loadLocalStorage(KEY)).toEqual({ width: 992, height: 640 });

    pointer(handle("corner"), "pointerdown", 0, 0);
    pointer(handle("corner"), "pointermove", -1000, -1000);
    pointer(handle("corner"), "pointercancel", 0, 0);
    expect(size()).toBe("352px x 320px");
    expect(modalEl().classList.contains("is-resizing")).toBe(false);
    pointer(handle("corner"), "pointermove", 500, 500);
    expect(size()).toBe("352px x 320px");
  });

  it("R3 resizes with arrow keys, resets with Home or double-click and restores on reopen", () => {
    const app = new App();
    const modal = openModal(app);
    expect(key(handle("bottom"), "ArrowDown").defaultPrevented).toBe(true);
    expect(key(handle("bottom"), "Enter").defaultPrevented).toBe(false);
    key(handle("bottom"), "ArrowRight");
    expect(size()).toBe("680px x 656px");
    key(handle("right"), "ArrowLeft", true);
    expect(size()).toBe("616px x 656px");
    expect(handle("right").getAttribute("aria-valuenow")).toBe("616");
    modal.close();

    openModal(app).close();
    const reopened = openModal(app);
    expect(size()).toBe("616px x 656px");
    handle("corner").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(size()).toBe("680px x 640px");
    expect(app.loadLocalStorage(KEY)).toBeNull();
    key(handle("corner"), "ArrowUp");
    key(handle("corner"), "Home");
    expect(size()).toBe("680px x 640px");
    reopened.close();
  });

  it("R4 ignores malformed stored sizes and survives a failing store", () => {
    const app = new App();
    app.saveLocalStorage(KEY, { width: Number.NaN, height: 400 });
    const invalid = openModal(app);
    expect(size()).toBe("680px x 640px");
    invalid.close();
    app.saveLocalStorage(KEY, { width: 5000, height: 100 });
    const clamped = openModal(app);
    expect(size()).toBe("992px x 320px");
    clamped.close();

    vi.spyOn(app, "loadLocalStorage").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(app, "saveLocalStorage").mockImplementation(() => {
      throw new Error("blocked");
    });
    openModal(app);
    expect(size()).toBe("680px x 640px");
    expect(() => key(handle("right"), "ArrowRight")).not.toThrow();
    expect(size()).toBe("696px x 640px");
  });

  it("R5 re-clamps on window resize and removes every listener on close, even mid-drag", async () => {
    const app = new App();
    const addWindow = vi.spyOn(window, "addEventListener");
    const removeWindow = vi.spyOn(window, "removeEventListener");
    const modal = openModal(app);
    const right = handle("right");
    const removeHandle = vi.spyOn(right, "removeEventListener");
    key(right, "ArrowRight", true);
    setWindowWidth(600);
    expect(size()).toBe("568px x 640px");
    expect(app.loadLocalStorage(KEY)).toEqual({ width: 744, height: 640 });
    setWindowWidth(1024);
    expect(size()).toBe("744px x 640px");
    setWindowWidth(600);
    key(right, "ArrowLeft");
    setWindowWidth(1024);
    expect(size()).toBe("552px x 640px");
    setWindowWidth(600);

    pointer(right, "pointerdown", 0, 0);
    const el = modalEl();
    modal.close();
    await settle();
    expect(el.classList.contains("is-resizing")).toBe(false);
    expect(el.querySelector(".attest-sub-agents__resize")).toBeNull();
    const resizeAdds = addWindow.mock.calls.filter(([type]) => type === "resize");
    const resizeRemoves = removeWindow.mock.calls.filter(([type]) => type === "resize");
    expect(resizeRemoves.map(([, fn]) => fn)).toEqual(resizeAdds.map(([, fn]) => fn));
    expect(removeHandle.mock.calls.map(([type]) => type)).toContain("pointermove");
    pointer(right, "pointermove", 300, 0);
    expect(el.style.getPropertyValue("--attest-sub-agents-width")).toBe("552px");
  });

  it("R6 follows only the first primary pointer and releases its capture", () => {
    const app = new App();
    openModal(app);
    const right = handle("right");
    const release = vi.fn();
    Object.assign(right, { hasPointerCapture: () => true, releasePointerCapture: release });
    pointer(right, "pointerdown", 0, 0, { button: 2 });
    expect(modalEl().classList.contains("is-resizing")).toBe(false);

    pointer(right, "pointerdown", 0, 0);
    pointer(right, "pointerdown", 100, 0, { pointerId: 2, pointerType: "touch" });
    pointer(right, "pointermove", 140, 0, { pointerId: 2, pointerType: "touch" });
    pointer(right, "pointerup", 0, 0, { pointerId: 2, pointerType: "touch" });
    pointer(right, "lostpointercapture", 0, 0, { pointerId: 2 });
    expect(size()).toBe("680px x 640px");
    expect(modalEl().classList.contains("is-resizing")).toBe(true);
    pointer(right, "pointermove", 10, 0);
    pointer(right, "pointerup", 10, 0);
    expect(size()).toBe("700px x 640px");
    expect(modalEl().classList.contains("is-resizing")).toBe(false);
    expect(release).toHaveBeenCalledWith(1);
  });
});
