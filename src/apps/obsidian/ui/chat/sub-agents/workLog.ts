import type { App, Component } from "obsidian";

import type { Translate } from "@adapters/i18n";
import type { SubAgentWorkflowItem } from "@core/research";
import {
  captureWorkflowUiState,
  renderWorkflowTimeline,
  toSubAgentWorkflowModel,
  type WorkflowTimelineHandle,
} from "../workflow/index";

export const WORK_LOG_PAGE_SIZE = 50;

export interface WorkLogDeps {
  app: App;
  markdownContext: Component;
  t: Translate;
}

export interface WorkLogInput {
  sessionId: string;
  items: readonly SubAgentWorkflowItem[];
  selectedRunId: string | null;
  debug: boolean;
}

/**
 * Owns the shared workflow timeline of one child session inside the details screen. The
 * text-only output viewer lives inside the timeline host, so an open output survives a
 * live re-render; leaving debug mode drops the viewer and every payload from the DOM.
 */
export class WorkLogView {
  private handle: WorkflowTimelineHandle | null = null;
  private timelineEl: HTMLElement | null = null;
  private limit = WORK_LOG_PAGE_SIZE;
  private last: WorkLogInput | null = null;

  constructor(
    private readonly hostEl: HTMLElement,
    private readonly deps: WorkLogDeps,
  ) {}

  render(input: WorkLogInput): void {
    const uiState =
      input.debug && this.last?.debug && this.timelineEl
        ? captureWorkflowUiState(this.timelineEl)
        : undefined;
    this.release();
    this.last = input;
    const { t } = this.deps;
    const sorted = [...input.items].sort((a, b) => a.sequence - b.sequence);
    if (sorted.length === 0) {
      this.hostEl.createDiv({
        cls: "attest-sub-agents__work-empty",
        text: t("chat.subAgents.work.empty"),
      });
      return;
    }
    const scopeId = `sub-agent:${input.sessionId}`;
    const keyOf = (item: SubAgentWorkflowItem): string => `${scopeId}/${item.runId}/${item.id}`;
    const shown = sorted.filter(
      (item, index) =>
        index < this.limit || item.status === "pending" || keyOf(item) === uiState?.openOutputKey,
    );
    const timelineEl = this.hostEl.createDiv({ cls: "attest-sub-agents__timeline" });
    this.timelineEl = timelineEl;
    this.handle = renderWorkflowTimeline(
      timelineEl,
      toSubAgentWorkflowModel(input.sessionId, shown, "complete"),
      {
        app: this.deps.app,
        markdownContext: this.deps.markdownContext,
        isDebugMode: input.debug,
        t,
        onOpenToolOutput: () => undefined,
        outputViewerHost: timelineEl,
      },
      uiState,
    );
    this.markRuns(new Map(shown.map((item) => [keyOf(item), item.runId])), input.selectedRunId);
    const hidden = sorted.length - shown.length;
    if (hidden > 0) {
      const more = this.hostEl.createEl("button", {
        cls: "attest-sub-agents__more",
        text: t("chat.subAgents.work.showMore", { count: hidden }),
        attr: { type: "button" },
      });
      more.addEventListener("click", () => {
        this.limit += WORK_LOG_PAGE_SIZE;
        if (this.last) this.render(this.last);
      });
    }
  }

  /** Scrolls the first call of the selected run into view without hiding the others. */
  revealSelectedRun(): void {
    const first = this.timelineEl?.querySelector<HTMLElement>(".attest-sub-agents__run-selected");
    first?.scrollIntoView?.({ block: "nearest" });
  }

  dispose(): void {
    this.release();
    this.last = null;
  }

  private release(): void {
    const handle = this.handle;
    this.handle = null;
    handle?.dispose();
    this.timelineEl = null;
    this.hostEl.empty();
  }

  private markRuns(runOf: Map<string, string>, selectedRunId: string | null): void {
    if (!selectedRunId || !this.timelineEl) return;
    this.timelineEl.querySelectorAll<HTMLElement>("[data-tool-key]").forEach((node) => {
      const runId = runOf.get(node.dataset.toolKey ?? "");
      if (runId === undefined) return;
      node.toggleClass("attest-sub-agents__run-selected", runId === selectedRunId);
      node.toggleClass("attest-sub-agents__run-dimmed", runId !== selectedRunId);
    });
  }
}
