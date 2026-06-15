const WHEEL_DELTA_LINE = 1;
const WHEEL_DELTA_PAGE = 2;

export interface HorizontalWheelScrollState {
  clientWidth: number;
  scrollWidth: number;
  scrollLeft: number;
  deltaX: number;
  deltaY: number;
  deltaMode: number;
}

export function nextHorizontalWheelScrollLeft(state: HorizontalWheelScrollState): number | null {
  const maxScrollLeft = Math.max(0, state.scrollWidth - state.clientWidth);

  if (maxScrollLeft === 0) {
    return null;
  }

  const rawDelta =
    Math.abs(state.deltaX) > Math.abs(state.deltaY) ? state.deltaX : state.deltaY;

  if (rawDelta === 0) {
    return null;
  }

  const delta = wheelDeltaToPixels(rawDelta, state.deltaMode, state.clientWidth);
  const nextScrollLeft = Math.min(maxScrollLeft, Math.max(0, state.scrollLeft + delta));

  return nextScrollLeft === state.scrollLeft ? null : nextScrollLeft;
}

function wheelDeltaToPixels(delta: number, deltaMode: number, pageSize: number): number {
  if (deltaMode === WHEEL_DELTA_LINE) {
    return delta * 16;
  }

  if (deltaMode === WHEEL_DELTA_PAGE) {
    return delta * pageSize;
  }

  return delta;
}
