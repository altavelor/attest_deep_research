import { MarkdownRenderer, setIcon } from "obsidian";

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
    cls: "ixplorer-chat__workflow-node ixplorer-chat__workflow-node--thinking",
  });
  node.createSpan({ cls: "ixplorer-chat__workflow-dot ixplorer-chat__workflow-dot--thinking" });
  const body = node.createDiv({ cls: "ixplorer-chat__workflow-body" });
  if (!active && isLongThinking(content)) {
    const details = body.createEl("details", {
      cls: "ixplorer-chat__thinking",
      attr: { "data-thinking-id": id },
    });
    details.open = uiState?.openThinking.has(id) ?? false;
    const summary = details.createEl("summary", { cls: "ixplorer-chat__thinking-summary" });
    setIcon(summary.createSpan({ cls: "ixplorer-chat__thinking-caret" }), "chevron-right");
    summary.createSpan({ cls: "ixplorer-chat__thinking-summary-label", text: "Thinking" });
    void MarkdownRenderer.render(
      renderContext.app,
      content,
      details.createDiv({ cls: "ixplorer-chat__workflow-text" }),
      "",
      renderContext.markdownContext,
    );
    return;
  }
  if (active) body.createDiv({ cls: "ixplorer-chat__workflow-heading", text: "Thinking…" });
  void MarkdownRenderer.render(
    renderContext.app,
    content,
    body.createDiv({ cls: "ixplorer-chat__workflow-text" }),
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
    cls: "ixplorer-chat__workflow-node ixplorer-chat__workflow-node--summary",
  });
  node.createSpan({ cls: "ixplorer-chat__workflow-dot ixplorer-chat__workflow-dot--thinking" });
  void MarkdownRenderer.render(
    context.app,
    content,
    node
      .createDiv({ cls: "ixplorer-chat__workflow-body" })
      .createDiv({ cls: "ixplorer-chat__workflow-text" }),
    "",
    context.markdownContext,
  );
}

export function renderWorkflowIndicator(
  listEl: HTMLElement,
  isStreaming: boolean,
  isFinalizing: boolean,
  hasStreamingCheckpoint: boolean,
  activeReasoningId?: string,
): void {
  if (isFinalizing) renderActiveThinkingNode(listEl, "Finalizing…");
  else if (isStreaming && !hasStreamingCheckpoint && !activeReasoningId) {
    renderActiveThinkingNode(listEl, "Thinking…");
  }
}

function isLongThinking(content: string): boolean {
  return content.length > LONG_THINKING_CHARS || content.split("\n").length > 4;
}

function renderActiveThinkingNode(listEl: HTMLElement, label: "Thinking…" | "Finalizing…"): void {
  const isFinalizing = label === "Finalizing…";
  const node = listEl.createDiv({
    cls: `ixplorer-chat__workflow-node ixplorer-chat__workflow-node--thinking-active${isFinalizing ? " ixplorer-chat__workflow-node--finalizing" : ""}`,
  });
  node.createSpan({
    cls: `ixplorer-chat__workflow-dot ixplorer-chat__workflow-dot--${isFinalizing ? "finalizing" : "thinking"}`,
  });
  node.createDiv({ cls: "ixplorer-chat__workflow-heading", text: label });
}
