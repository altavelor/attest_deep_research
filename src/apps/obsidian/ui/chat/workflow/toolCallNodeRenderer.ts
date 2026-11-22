import { toolTitle } from "@core/agent";
import { ChainItem } from "@core/conversation";
import { describeToolCall, ToolCell } from "../toolCallView";
import type { TimelineScope } from "./timelineResources";
import { toolKey } from "./toolKey";

type ToolCallItem = Extract<ChainItem, { kind: "tool-call" }>;

export function renderToolNode(
  listEl: HTMLElement,
  item: ToolCallItem,
  scope: TimelineScope,
  fetchTargets?: string[],
): void {
  const { context } = scope;
  const view = describeToolCall({
    name: item.name,
    label: item.label,
    status: item.status,
    args: item.args,
    resultJson: item.resultJson,
    fetchTargets,
    searchSources: item.searchSources,
    t: context.t,
  });
  const node = listEl.createDiv({
    cls: `attest-chat__workflow-node attest-chat__workflow-node--tool attest-chat__workflow-node--${item.status}`,
    attr: { "data-tool-id": item.id, "data-tool-key": toolKey(scope.scopeId, item) },
  });
  node.createSpan({ cls: "attest-chat__workflow-dot attest-chat__workflow-dot--tool" });
  const body = node.createDiv({ cls: "attest-chat__workflow-body" });
  const head = body.createDiv({ cls: "attest-chat__tool-head" });
  head.createSpan({ cls: "attest-chat__tool-name", text: toolTitle(item.name) });
  if (view.intent) {
    if (view.fetchTargets.length > 0) {
      renderFetchTargets(head, view.intent, view.fetchTargets, item.status === "pending", scope);
    } else {
      head.createSpan({ cls: "attest-chat__tool-intent", text: view.intent });
    }
  }
  if (item.phase && item.status === "pending") {
    head.createSpan({ cls: "attest-chat__tool-phase", text: item.phase });
  }
  const badge = item.badge ?? view.badge;
  if (badge) {
    head.createSpan({
      cls: "attest-chat__tool-badge",
      text: badge.text,
      ...(badge.tooltip ? { attr: { "aria-label": badge.tooltip, title: badge.tooltip } } : {}),
    });
  }
  if (context.isDebugMode && item.payloadState && item.payloadState !== "captured") {
    body.createDiv({
      cls: "attest-chat__tool-payload-state",
      text: context.t(`chat.workflow.payload.${item.payloadState}`),
    });
  }
  const onOpen = (): void => scope.resources.openToolOutput(item);
  if (context.isDebugMode && view.inCell) {
    renderToolCell(
      body,
      `${item.id}:in`,
      context.t("chat.workflow.tool.in"),
      safeCell(item, view.inCell),
      scope,
      {
        variant: "in",
        onOpen,
      },
    );
  }
  if (context.isDebugMode && view.outCell) {
    renderToolCell(
      body,
      `${item.id}:out`,
      context.t("chat.workflow.tool.out"),
      safeCell(item, view.outCell),
      scope,
      { variant: "out", onOpen },
    );
  }
  if (item.children && item.children.length > 0) {
    const nested = body.createDiv({
      cls: "attest-chat__workflow attest-chat__workflow--nested",
    });
    for (const child of item.children) {
      if (child.kind === "tool-call") renderToolNode(nested, child, scope);
    }
  }
}

function safeCell(item: ToolCallItem, cell: ToolCell): ToolCell {
  return item.untrusted && cell.kind === "text" ? { kind: "code", text: cell.text } : cell;
}

function renderFetchTargets(
  head: HTMLElement,
  intent: string,
  targets: string[],
  animate: boolean,
  scope: TimelineScope,
): void {
  head.createSpan({
    cls: "attest-chat__tool-intent attest-chat__tool-intent--fetch",
    text: intent,
  });
  const targetList = head.createSpan({
    cls: "attest-chat__tool-fetch-targets",
    attr: {
      "aria-label": scope.context.t("chat.workflow.tool.fetching.aria", {
        targets: targets.join(", "),
      }),
    },
  });
  const targetElements = targets.map((target) =>
    targetList.createSpan({
      cls: "attest-chat__tool-fetch-target",
      text: target,
      attr: { "aria-hidden": "true" },
    }),
  );
  targetElements[0]?.addClass("attest-chat__tool-fetch-target--active");
  if (animate) scope.resources.animateFetchTargets(targetList, targetElements);
}

function renderToolCell(
  parentEl: HTMLElement,
  cellId: string,
  label: string,
  cell: ToolCell,
  scope: TimelineScope,
  cellOptions: { variant: "in" | "out"; onOpen: () => void },
): void {
  const wrap = parentEl.createDiv({
    cls: `attest-chat__tool-cell attest-chat__tool-cell--${cellOptions.variant}`,
    attr: { "data-tool-cell-id": cellId, role: "button", tabindex: "0" },
  });
  const header = wrap.createDiv({ cls: "attest-chat__tool-cell-header" });
  header.createSpan({ cls: "attest-chat__tool-cell-label", text: label });
  header.createSpan({
    cls: "attest-chat__tool-cell-open-hint",
    text: scope.context.t("chat.workflow.tool.openFullOutput"),
  });
  renderToolCellBody(wrap.createDiv({ cls: "attest-chat__tool-cell-body" }), cell, scope);
  const signal = scope.resources.listenerSignal;
  wrap.addEventListener(
    "click",
    () => {
      if (!hasTextSelectionWithin(wrap)) cellOptions.onOpen();
    },
    { signal },
  );
  wrap.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        cellOptions.onOpen();
      }
    },
    { signal },
  );
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

function renderToolCellBody(bodyEl: HTMLElement, cell: ToolCell, scope: TimelineScope): void {
  if (cell.kind === "code") {
    bodyEl
      .createEl("pre", { cls: "attest-chat__tool-cell-code" })
      .createEl("code", { text: cell.text });
    return;
  }
  if (cell.kind === "text") {
    scope.resources.renderMarkdown(cell.text, bodyEl);
    return;
  }
  const diffEl = bodyEl.createDiv({ cls: "attest-chat__diff" });
  cell.hunks.forEach((hunk, index) => {
    if (index > 0) diffEl.createDiv({ cls: "attest-chat__diff-gap", text: "⋯" });
    for (const line of hunk.lines) {
      const lineEl = diffEl.createDiv({
        cls: `attest-chat__diff-line attest-chat__diff-line--${line.type}`,
      });
      lineEl.createSpan({
        cls: "attest-chat__diff-sign",
        text: line.type === "add" ? "+" : line.type === "remove" ? "−" : " ",
      });
      lineEl.createSpan({ cls: "attest-chat__diff-text", text: line.text });
    }
  });
}
