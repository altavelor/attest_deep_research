import type { MessageKey, Translate } from "@adapters/i18n";
import {
  clampSize,
  defaultSize,
  dragSize,
  keyboardResize,
  parsePersistedSize,
  sizeBounds,
  type ModalSize,
  type ResizeAxis,
} from "./modalSize";

export const MODAL_SIZE_STORAGE_KEY = "attest-sub-agents-modal-size";

export interface ModalSizeStore {
  loadLocalStorage(key: string): unknown;
  saveLocalStorage(key: string, data: unknown): void;
}

interface HandleSpec {
  axis: ResizeAxis;
  cls: string;
  label: MessageKey;
  orientation?: "vertical" | "horizontal";
}

interface Drag {
  handle: HTMLElement;
  pointerId: number;
  startX: number;
  startY: number;
  start: ModalSize;
  axis: ResizeAxis;
}

/**
 * Adds right, bottom and corner resize handles to a centred modal, driven by pointer and keyboard.
 * The modal grows symmetrically around its centre, stays inside the viewport, and its size is
 * persisted per vault; dispose removes every listener and ends an active drag.
 */
export class ModalResizeController {
  private readonly cleanups: Array<() => void> = [];
  private readonly handles = new Map<HTMLElement, HandleSpec["orientation"]>();
  private size: ModalSize = { width: 0, height: 0 };
  private drag: Drag | null = null;

  constructor(
    private readonly modalEl: HTMLElement,
    private readonly store: ModalSizeStore,
    private readonly t: Translate,
  ) {}

  attach(): void {
    this.modalEl.addClass("attest-sub-agents-modal--resizable");
    this.size = this.restore();
    const specs: HandleSpec[] = [
      { axis: "x", cls: "right", label: "chat.subAgents.resize.width", orientation: "vertical" },
      {
        axis: "y",
        cls: "bottom",
        label: "chat.subAgents.resize.height",
        orientation: "horizontal",
      },
      { axis: "both", cls: "corner", label: "chat.subAgents.resize.both" },
    ];
    for (const spec of specs) this.createHandle(spec);
    this.apply();
    const win = this.modalEl.win ?? window;
    const onWindowResize = (): void => this.setSize(this.size, false);
    win.addEventListener("resize", onWindowResize);
    this.cleanups.push(() => win.removeEventListener("resize", onWindowResize));
  }

  dispose(): void {
    this.endDrag();
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    for (const handle of this.handles.keys()) handle.remove();
    this.handles.clear();
  }

  private createHandle(spec: HandleSpec): void {
    const handle = this.modalEl.createDiv({
      cls: `attest-sub-agents__resize attest-sub-agents__resize--${spec.cls}`,
      attr: { role: "separator", tabindex: "0", "aria-label": this.t(spec.label) },
    });
    if (spec.orientation) handle.setAttr("aria-orientation", spec.orientation);
    this.handles.set(handle, spec.orientation);
    this.listen(handle, "pointerdown", (event) => this.startDrag(handle, spec.axis, event));
    this.listen(handle, "pointermove", (event) => this.moveDrag(event));
    this.listen(handle, "pointerup", () => this.endDrag(true));
    this.listen(handle, "pointercancel", () => this.endDrag(true));
    this.listen(handle, "lostpointercapture", () => this.endDrag(true));
    this.listen(handle, "dblclick", () => this.reset());
    this.listen(handle, "keydown", (event) => this.onKey(spec.axis, event));
  }

  private listen<K extends keyof HTMLElementEventMap>(
    el: HTMLElement,
    type: K,
    listener: (event: HTMLElementEventMap[K]) => void,
  ): void {
    el.addEventListener(type, listener);
    this.cleanups.push(() => el.removeEventListener(type, listener));
  }

  private startDrag(handle: HTMLElement, axis: ResizeAxis, event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    this.drag = {
      handle,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      start: { ...this.size },
      axis,
    };
    handle.setPointerCapture?.(event.pointerId);
    this.modalEl.addClass("is-resizing");
  }

  private moveDrag(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    this.setSize(dragSize(drag.start, dx, dy, drag.axis), false);
  }

  private endDrag(persist = false): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    this.modalEl.removeClass("is-resizing");
    if (drag.handle.hasPointerCapture?.(drag.pointerId)) {
      drag.handle.releasePointerCapture(drag.pointerId);
    }
    if (persist) this.persist();
  }

  private onKey(axis: ResizeAxis, event: KeyboardEvent): void {
    const next = keyboardResize(event.key, event.shiftKey, axis, this.size);
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    if (next === "reset") this.reset();
    else this.setSize(next, true);
  }

  private reset(): void {
    this.size = defaultSize(this.bounds());
    this.apply();
    this.persist(null);
  }

  private setSize(size: ModalSize, persist: boolean): void {
    this.size = clampSize(size, this.bounds());
    this.apply();
    if (persist) this.persist();
  }

  private restore(): ModalSize {
    const bounds = this.bounds();
    let raw: unknown = null;
    try {
      raw = this.store.loadLocalStorage(MODAL_SIZE_STORAGE_KEY);
    } catch {
      raw = null;
    }
    return parsePersistedSize(raw, bounds) ?? defaultSize(bounds);
  }

  private persist(value: ModalSize | null = this.size): void {
    try {
      this.store.saveLocalStorage(MODAL_SIZE_STORAGE_KEY, value && { ...value });
    } catch {
      return;
    }
  }

  private bounds() {
    const win = this.modalEl.win ?? window;
    return sizeBounds({ width: win.innerWidth, height: win.innerHeight });
  }

  private apply(): void {
    this.modalEl.style.setProperty("--attest-sub-agents-width", `${this.size.width}px`);
    this.modalEl.style.setProperty("--attest-sub-agents-height", `${this.size.height}px`);
    for (const [handle, orientation] of this.handles) {
      const value = orientation === "vertical" ? this.size.width : this.size.height;
      if (orientation) handle.setAttr("aria-valuenow", String(value));
    }
  }
}
