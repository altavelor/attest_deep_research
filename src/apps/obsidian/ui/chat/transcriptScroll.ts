const STICK_TO_BOTTOM_THRESHOLD_PX = 60;

export interface ScrollAnchor {
  stickToBottom: boolean;
  previousScrollTop: number;
}

/** Records whether the transcript follows its bottom edge before a re-render. */
export function captureScrollAnchor(transcriptEl: HTMLElement): ScrollAnchor {
  const distanceFromBottom =
    transcriptEl.scrollHeight - transcriptEl.scrollTop - transcriptEl.clientHeight;
  return {
    stickToBottom: distanceFromBottom <= STICK_TO_BOTTOM_THRESHOLD_PX,
    previousScrollTop: transcriptEl.scrollTop,
  };
}

/** Restores the bottom-following or the previous scroll offset after a re-render. */
export function applyScrollAnchor(transcriptEl: HTMLElement, anchor: ScrollAnchor): void {
  transcriptEl.scrollTop = anchor.stickToBottom
    ? transcriptEl.scrollHeight
    : anchor.previousScrollTop;
}
