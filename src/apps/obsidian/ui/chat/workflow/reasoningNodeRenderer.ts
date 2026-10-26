import { setIcon } from "obsidian";

import type { Translate } from "@adapters/i18n";
import type { WorkflowUiState } from "./renderContext";
import type { TimelineScope } from "./timelineResources";

const LONG_THINKING_CHARS = 280;

export function renderThinkingNode(
  listEl: HTMLElement,
  id: string,
  content: string,
  context: { active: boolean; scope: TimelineScope; uiState?: WorkflowUiState },
): void {
  const { active, scope, uiState } = context;
  const renderContext = scope.context;
  const node = listEl.createDiv({
    cls: "attest-chat__workflow-node attest-chat__workflow-node--thinking",
  });
  node.createSpan({ cls: "attest-chat__workflow-dot attest-chat__workflow-dot--thinking" });
  const body = node.createDiv({ cls: "attest-chat__workflow-body" });
  if (!active && isLongThinking(content)) {
    const details = body.createEl("details", {
      cls: "attest-chat__thinking",
      attr: { "data-thinking-id": id },
    });
    details.open = uiState?.openThinking.has(id) ?? false;
    const summary = details.createEl("summary", { cls: "attest-chat__thinking-summary" });
    setIcon(summary.createSpan({ cls: "attest-chat__thinking-caret" }), "chevron-right");
    summary.createSpan({
      cls: "attest-chat__thinking-summary-label",
      text: renderContext.t("chat.workflow.thinking"),
    });
    scope.resources.renderMarkdown(
      content,
      details.createDiv({ cls: "attest-chat__workflow-text" }),
    );
    return;
  }
  if (active) {
    body.createDiv({
      cls: "attest-chat__workflow-heading",
      text: renderContext.t("chat.workflow.thinkingActive"),
    });
  }
  scope.resources.renderMarkdown(content, body.createDiv({ cls: "attest-chat__workflow-text" }));
}

export function renderSummaryNode(
  listEl: HTMLElement,
  content: string,
  scope: TimelineScope,
): void {
  const node = listEl.createDiv({
    cls: "attest-chat__workflow-node attest-chat__workflow-node--summary",
  });
  node.createSpan({ cls: "attest-chat__workflow-dot attest-chat__workflow-dot--thinking" });
  scope.resources.renderMarkdown(
    content,
    node
      .createDiv({ cls: "attest-chat__workflow-body" })
      .createDiv({ cls: "attest-chat__workflow-text" }),
  );
}

export function renderWorkflowIndicator(
  listEl: HTMLElement,
  isStreaming: boolean,
  isFinalizing: boolean,
  hasStreamingCheckpoint: boolean,
  t: Translate,
  activeReasoningId?: string,
): void {
  if (isFinalizing) renderActiveThinkingNode(listEl, "finalizing", t);
  else if (isStreaming && !hasStreamingCheckpoint && !activeReasoningId) {
    renderActiveThinkingNode(listEl, "thinking", t);
  }
}

function isLongThinking(content: string): boolean {
  return content.length > LONG_THINKING_CHARS || content.split("\n").length > 4;
}

function renderActiveThinkingNode(
  listEl: HTMLElement,
  phase: "thinking" | "finalizing",
  t: Translate,
): void {
  const isFinalizing = phase === "finalizing";
  const node = listEl.createDiv({
    cls: `attest-chat__workflow-node attest-chat__workflow-node--thinking-active${isFinalizing ? " attest-chat__workflow-node--finalizing" : ""}`,
  });
  node.createSpan({
    cls: `attest-chat__workflow-dot attest-chat__workflow-dot--${isFinalizing ? "finalizing" : "thinking"}`,
  });
  node.createDiv({
    cls: "attest-chat__workflow-heading",
    text: isFinalizing ? t("chat.workflow.finalizing") : t("chat.workflow.thinkingActive"),
  });
}
