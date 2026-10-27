export interface ModalSize {
  width: number;
  height: number;
}

export interface ModalSizeBounds {
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
}

export type ResizeAxis = "x" | "y" | "both";

export const MODAL_MIN_WIDTH = 352;
export const MODAL_MIN_HEIGHT = 320;
export const MODAL_VIEWPORT_MARGIN = 16;
export const MODAL_DEFAULT_WIDTH = 680;
export const MODAL_DEFAULT_HEIGHT = 640;
export const RESIZE_STEP = 16;
export const RESIZE_STEP_LARGE = 64;

/** Computes the size limits for a viewport; the viewport limit wins over the minimum when the window is smaller. */
export function sizeBounds(viewport: ModalSize): ModalSizeBounds {
  const maxWidth = Math.max(0, Math.floor(viewport.width - 2 * MODAL_VIEWPORT_MARGIN));
  const maxHeight = Math.max(0, Math.floor(viewport.height - 2 * MODAL_VIEWPORT_MARGIN));
  return {
    minWidth: Math.min(MODAL_MIN_WIDTH, maxWidth),
    minHeight: Math.min(MODAL_MIN_HEIGHT, maxHeight),
    maxWidth,
    maxHeight,
  };
}

/** Clamps a size into the bounds and rounds it to whole pixels. */
export function clampSize(size: ModalSize, bounds: ModalSizeBounds): ModalSize {
  return {
    width: Math.round(Math.min(bounds.maxWidth, Math.max(bounds.minWidth, size.width))),
    height: Math.round(Math.min(bounds.maxHeight, Math.max(bounds.minHeight, size.height))),
  };
}

/** Returns the default modal size clamped into the bounds. */
export function defaultSize(bounds: ModalSizeBounds): ModalSize {
  return clampSize({ width: MODAL_DEFAULT_WIDTH, height: MODAL_DEFAULT_HEIGHT }, bounds);
}

/** Resizes symmetrically around the centred modal so the dragged edge follows the pointer. */
export function dragSize(start: ModalSize, dx: number, dy: number, axis: ResizeAxis): ModalSize {
  return {
    width: axis === "y" ? start.width : start.width + 2 * dx,
    height: axis === "x" ? start.height : start.height + 2 * dy,
  };
}

/** Maps a handle key press to a size change, a reset, or null when the key is not a resize key. */
export function keyboardResize(
  key: string,
  shift: boolean,
  axis: ResizeAxis,
  current: ModalSize,
): ModalSize | "reset" | null {
  if (key === "Home") return "reset";
  const step = shift ? RESIZE_STEP_LARGE : RESIZE_STEP;
  const horizontal: Record<string, number> = { ArrowRight: step, ArrowLeft: -step };
  const vertical: Record<string, number> = { ArrowDown: step, ArrowUp: -step };
  const dw = axis === "y" ? undefined : horizontal[key];
  const dh = axis === "x" ? undefined : vertical[key];
  if (dw === undefined && dh === undefined) return null;
  return { width: current.width + (dw ?? 0), height: current.height + (dh ?? 0) };
}

/** Validates a persisted size and clamps it into the bounds; anything else yields null. */
export function parsePersistedSize(raw: unknown, bounds: ModalSizeBounds): ModalSize | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { width, height } = raw as Record<string, unknown>;
  if (!isPositiveNumber(width) || !isPositiveNumber(height)) return null;
  return clampSize({ width, height }, bounds);
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
