import { MarkdownRenderer, setIcon } from "obsidian";

import type { Translate } from "@adapters/i18n";
import type { WorkflowRenderContext, WorkflowUiState } from "../workflowRenderer";

const LONG_THINKING_CHARS = 280;

export function renderThinkingNode(
  listEl: HTMLElement,
  id: string,
  content: string,
  context: { active: boolean; renderContext: WorkflowRenderContext; uiState?: WorkflowUiState },
): void {
  const { active, renderContext, uiState } = context;
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
    void MarkdownRenderer.render(
      renderContext.app,
      content,
      details.createDiv({ cls: "attest-chat__workflow-text" }),
      "",
      renderContext.markdownContext,
    );
    return;
  }
  if (active) {
    body.createDiv({
      cls: "attest-chat__workflow-heading",
      text: renderContext.t("chat.workflow.thinkingActive"),
    });
  }
  void MarkdownRenderer.render(
    renderContext.app,
    content,
    body.createDiv({ cls: "attest-chat__workflow-text" }),
    "",
    renderContext.markdownContext,
  );
}

export function renderSummaryNode(
  listEl: HTMLElement,
  content: string,
  context: WorkflowRenderContext,
): void {
  const node = listEl.createDiv({
    cls: "attest-chat__workflow-node attest-chat__workflow-node--summary",
  });
  node.createSpan({ cls: "attest-chat__workflow-dot attest-chat__workflow-dot--thinking" });
  void MarkdownRenderer.render(
    context.app,
    content,
    node
      .createDiv({ cls: "attest-chat__workflow-body" })
      .createDiv({ cls: "attest-chat__workflow-text" }),
    "",
    context.markdownContext,
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
