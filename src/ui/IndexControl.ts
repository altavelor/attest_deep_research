import { setIcon } from "obsidian";

import { IndexingState } from "../indexing/IndexingService";
import {
  formatIndexControlSummary,
  formatIndexingProgressLabel,
  formatIndexingStateLabel,
  formatProgressPercent,
  indexingProgressValue,
} from "./rendering";

export interface IndexControlActions {
  start(): void | Promise<unknown>;
  pause(): void | Promise<unknown>;
  resume(): void | Promise<unknown>;
  rebuild(): void | Promise<unknown>;
}

export interface IndexControlOptions {
  state?: IndexingState;
  actions: IndexControlActions;
  compact?: boolean;
  onHide?: () => void | Promise<void>;
}

export function renderIndexControl(containerEl: HTMLElement, options: IndexControlOptions): void {
  containerEl.empty();

  const state = options.state;
  const isError = state?.status === "error";
  const root = containerEl.createDiv({
    cls: `ixplorer-index-control${options.compact ? " ixplorer-index-control--compact" : ""}${
      isError ? " ixplorer-index-control--error" : ""
    }`,
  });

  const summary = root.createDiv({ cls: "ixplorer-index-control__summary" });
  summary.createDiv({
    cls: "ixplorer-index-control__status",
    text: state ? formatIndexingStateLabel(state) : "Unavailable",
  });
  summary.createDiv({
    cls: "ixplorer-index-control__details",
    text: formatIndexControlSummary(state),
  });

  if (state?.status === "indexing") {
    const progressValue = indexingProgressValue(state);
    const progress = root.createDiv({
      cls: "ixplorer-index-control__progress",
      attr: {
        role: "progressbar",
        "aria-valuemin": "0",
        "aria-valuemax": "100",
        "aria-valuenow": String(Math.round(progressValue * 100)),
      },
    });
    progress.createDiv({
      cls: "ixplorer-index-control__progress-fill",
      attr: { style: `width: ${formatProgressPercent(progressValue)}` },
    });
    root.createDiv({
      cls: "ixplorer-index-control__progress-label",
      text: formatIndexingProgressLabel(state),
    });
  }

  const actions = root.createDiv({ cls: "ixplorer-index-control__actions" });
  const isIndexing = state?.status === "indexing";
  const isPaused = state?.status === "paused";

  if (!isIndexing && !isPaused && !isError) {
    createIconButton(actions, {
      icon: "play",
      label: "Start indexing",
      text: "Start",
      disabled: false,
      onClick: options.actions.start,
    });
  }

  if (isIndexing || isPaused) {
    createIconButton(actions, {
      icon: isPaused ? "play" : "pause",
      label: isPaused ? "Continue indexing" : "Pause indexing",
      text: isPaused ? "Continue" : "Pause",
      disabled: false,
      onClick: isPaused ? options.actions.resume : options.actions.pause,
    });
  }

  createIconButton(actions, {
    icon: "refresh-cw",
    label: "Rebuild index",
    text: "Rebuild",
    disabled: isIndexing,
    onClick: options.actions.rebuild,
  });

  if (options.onHide && !isError) {
    createIconButton(actions, {
      icon: "eye-off",
      label: "Hide index controls",
      disabled: false,
      onClick: options.onHide,
    });
  }
}

function createIconButton(
  containerEl: HTMLElement,
  options: {
    icon: string;
    label: string;
    text?: string;
    disabled: boolean;
    onClick: () => void | Promise<unknown>;
  },
): HTMLButtonElement {
  const button = containerEl.createEl("button", {
    cls: "ixplorer-index-control__button",
    attr: {
      type: "button",
      "aria-label": options.label,
      title: options.label,
    },
  });
  button.disabled = options.disabled;
  setIcon(button, options.icon);

  if (options.text) {
    button.createSpan({ text: options.text });
  }

  button.addEventListener("click", () => {
    void options.onClick();
  });

  return button;
}
