import { MarkdownRenderer } from "obsidian";

import { toolTitle } from "@core/agent";
import { ChainItem } from "@core/conversation";
import { animateFetchTargets } from "../fetchTargetAnimator";
import { describeToolCall, ToolCell } from "../toolCallView";
import type { WorkflowRenderContext } from "../workflowRenderer";

export function renderToolNode(
  listEl: HTMLElement,
  item: Extract<ChainItem, { kind: "tool-call" }>,
  context: WorkflowRenderContext,
  fetchTargets?: string[],
): void {
  const view = describeToolCall({
    name: item.name,
    label: item.label,
    status: item.status,
    args: item.args,
    resultJson: item.resultJson,
    fetchTargets,
    searchSources: item.searchSources,
  });
  const node = listEl.createDiv({
    cls: `ixplorer-chat__workflow-node ixplorer-chat__workflow-node--tool ixplorer-chat__workflow-node--${item.status}`,
    attr: { "data-tool-id": item.id },
  });
  node.createSpan({ cls: "ixplorer-chat__workflow-dot ixplorer-chat__workflow-dot--tool" });
  const body = node.createDiv({ cls: "ixplorer-chat__workflow-body" });
  const head = body.createDiv({ cls: "ixplorer-chat__tool-head" });
  head.createSpan({
    cls: "ixplorer-chat__tool-name",
    text: toolTitle(item.name),
  });
  if (view.intent) {
    if (view.fetchTargets.length > 0) {
      renderFetchTargets(head, view.intent, view.fetchTargets, item.status === "pending");
    } else {
      head.createSpan({ cls: "ixplorer-chat__tool-intent", text: view.intent });
    }
  }
  if (item.phase && item.status === "pending") {
    head.createSpan({ cls: "ixplorer-chat__tool-phase", text: item.phase });
  }
  if (view.badge) {
    head.createSpan({
      cls: "ixplorer-chat__tool-badge",
      text: view.badge.text,
      ...(view.badge.tooltip
        ? { attr: { "aria-label": view.badge.tooltip, title: view.badge.tooltip } }
        : {}),
    });
  }
  if (context.isDebugMode && view.inCell) {
    renderToolCell(body, `${item.id}:in`, "In", view.inCell, context, {
      variant: "in",
      onOpen: () => context.onOpenToolOutput(item),
    });
  }
  if (context.isDebugMode && view.outCell) {
    renderToolCell(body, `${item.id}:out`, "Out", view.outCell, context, {
      variant: "out",
      onOpen: () => context.onOpenToolOutput(item),
    });
  }
  if (item.children && item.children.length > 0) {
    const nested = body.createDiv({
      cls: "ixplorer-chat__workflow ixplorer-chat__workflow--nested",
    });
    for (const child of item.children) {
      if (child.kind === "tool-call") renderToolNode(nested, child, context);
    }
  }
}

function renderFetchTargets(
  head: HTMLElement,
  intent: string,
  targets: string[],
  animate: boolean,
): void {
  head.createSpan({
    cls: "ixplorer-chat__tool-intent ixplorer-chat__tool-intent--fetch",
    text: intent,
  });
  const targetList = head.createSpan({
    cls: "ixplorer-chat__tool-fetch-targets",
    attr: { "aria-label": `Fetching: ${targets.join(", ")}` },
  });
  const targetElements = targets.map((target) =>
    targetList.createSpan({
      cls: "ixplorer-chat__tool-fetch-target",
      text: target,
      attr: { "aria-hidden": "true" },
    }),
  );
  targetElements[0]?.addClass("ixplorer-chat__tool-fetch-target--active");
  if (animate) animateFetchTargets(targetList, targetElements);
}

function renderToolCell(
  parentEl: HTMLElement,
  cellId: string,
  label: string,
  cell: ToolCell,
  context: WorkflowRenderContext,
  cellOptions: { variant: "in" | "out"; onOpen: () => void },
): void {
  const wrap = parentEl.createDiv({
    cls: `ixplorer-chat__tool-cell ixplorer-chat__tool-cell--${cellOptions.variant}`,
    attr: { "data-tool-cell-id": cellId, role: "button", tabindex: "0" },
  });
  const header = wrap.createDiv({ cls: "ixplorer-chat__tool-cell-header" });
  header.createSpan({ cls: "ixplorer-chat__tool-cell-label", text: label });
  header.createSpan({ cls: "ixplorer-chat__tool-cell-open-hint", text: "Open full output" });
  renderToolCellBody(wrap.createDiv({ cls: "ixplorer-chat__tool-cell-body" }), cell, context);
  wrap.addEventListener("click", () => {
    if (!hasTextSelectionWithin(wrap)) cellOptions.onOpen();
  });
  wrap.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      cellOptions.onOpen();
    }
  });
}

function hasTextSelectionWithin(el: HTMLElement): boolean {
  const selection = el.ownerDocument.getSelection();
  return Boolean(
    selection &&
    !selection.isCollapsed &&
    selection.rangeCount > 0 &&
    selection.toString().trim() &&
    (el.contains(selection.anchorNode) || el.contains(selection.focusNode)),
  );
}

function renderToolCellBody(
  bodyEl: HTMLElement,
  cell: ToolCell,
  context: WorkflowRenderContext,
): void {
  if (cell.kind === "code") {
    bodyEl
      .createEl("pre", { cls: "ixplorer-chat__tool-cell-code" })
      .createEl("code", { text: cell.text });
    return;
  }
  if (cell.kind === "text") {
    void MarkdownRenderer.render(context.app, cell.text, bodyEl, "", context.markdownContext);
    return;
  }
  const diffEl = bodyEl.createDiv({ cls: "ixplorer-chat__diff" });
  cell.hunks.forEach((hunk, index) => {
    if (index > 0) diffEl.createDiv({ cls: "ixplorer-chat__diff-gap", text: "⋯" });
    for (const line of hunk.lines) {
      const lineEl = diffEl.createDiv({
        cls: `ixplorer-chat__diff-line ixplorer-chat__diff-line--${line.type}`,
      });
      lineEl.createSpan({
        cls: "ixplorer-chat__diff-sign",
        text: line.type === "add" ? "+" : line.type === "remove" ? "−" : " ",
      });
      lineEl.createSpan({ cls: "ixplorer-chat__diff-text", text: line.text });
    }
  });
}
