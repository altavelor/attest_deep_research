import type { App, Component } from "obsidian";

import type { Translate } from "@adapters/i18n";
import type { SubAgentWorkflowItem } from "@core/research";
import {
  captureWorkflowUiState,
  renderWorkflowTimeline,
  toSubAgentWorkflowModel,
  type WorkflowTimelineHandle,
  type WorkflowUiState,
} from "../workflow/index";

export const WORK_LOG_PAGE_SIZE = 50;

type FocusTarget = { kind: "cell"; id: string } | { kind: "close" } | { kind: "more" };

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
  private signature: string | null = null;

  constructor(
    private readonly hostEl: HTMLElement,
    private readonly deps: WorkLogDeps,
  ) {}

  render(input: WorkLogInput): void {
    const signature = JSON.stringify([
      input.sessionId,
      input.items,
      input.selectedRunId,
      input.debug,
      this.limit,
    ]);
    if (signature === this.signature) {
      this.last = input;
      return;
    }
    const focus = this.captureFocus();
    const uiState =
      input.debug && this.last?.debug && this.timelineEl
        ? captureWorkflowUiState(this.timelineEl)
        : undefined;
    this.release();
    this.signature = signature;
    this.last = input;
    this.renderContent(input, uiState);
    this.restoreFocus(focus);
  }

  private renderContent(input: WorkLogInput, uiState: WorkflowUiState | undefined): void {
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
      (item, index) => index < this.limit || keyOf(item) === uiState?.openOutputKey,
    );
    const timelineEl = this.hostEl.createDiv({
      cls: "attest-sub-agents__timeline attest-sub-agents__work-gutter",
    });
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
    this.signature = null;
  }

  private captureFocus(): FocusTarget | null {
    const active = this.hostEl.ownerDocument.activeElement;
    if (!(active instanceof HTMLElement) || !this.hostEl.contains(active)) return null;
    if (active.dataset.toolCellId) return { kind: "cell", id: active.dataset.toolCellId };
    if (active.hasClass("attest-chat__tool-output-viewer-close")) return { kind: "close" };
    if (active.hasClass("attest-sub-agents__more")) return { kind: "more" };
    return null;
  }

  private restoreFocus(focus: FocusTarget | null): void {
    if (!focus) return;
    const host = this.hostEl;
    let target: HTMLElement | null | undefined;
    if (focus.kind === "cell") {
      target = [...host.querySelectorAll<HTMLElement>("[data-tool-cell-id]")].find(
        (el) => el.dataset.toolCellId === focus.id,
      );
    } else if (focus.kind === "close") {
      target = host.querySelector<HTMLElement>(".attest-chat__tool-output-viewer-close");
    } else {
      target =
        host.querySelector<HTMLElement>(".attest-sub-agents__more") ??
        host.querySelector<HTMLElement>("[data-tool-cell-id]");
    }
    target?.focus();
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
