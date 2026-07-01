import { App, Component, MarkdownRenderer, setIcon } from "obsidian";

import { ContextDiagnostics } from "../../../../core/diagnostics";
import { RetrievedChunk } from "@core/model";
import { copyToClipboard } from "../shared/clipboard";
import { buildCitationRefs, ChatCitationRef, renderCitationBlocks } from "./citations/CitationPopover";
import { stripRenderedCitationIds } from "./citations/citationText";
import { ChainItem, ChatDisplayMessage } from "@core/conversation";
import { shouldShowDiagnosticAction } from "@core/conversation";
import { messageDisplayContent } from "./conversationFormatting";
import { messageMarkdownContent } from "@core/conversation";
import { describeToolCall, ToolCell } from "./toolCallView";

export interface ChatTranscriptOptions {
  app: App;
  markdownContext: Component;
  messages: ChatDisplayMessage[];
  editingMessageIndex: number | null;
  assistantLabel: string;
  isDebugMode: boolean;
  renderEmptyState(containerEl: HTMLElement): void;
  onEditQuestion(index: number): void;
  onSubmitEditedQuestion(index: number, value: string): void;
  onOpenCitationPopover(anchorEl: HTMLElement, ref: ChatCitationRef): void;
  onScheduleCitationPopoverClose(key: string): void;
  onScrollCitationBlockIntoView(key: string): void;
  onOpenChunk(chunk: RetrievedChunk): void;
  onHighlightCitation(key: string, highlighted: boolean): void;
  onOpenDiagnosticReport(diagnostics: ContextDiagnostics): void;
}

export function renderChatTranscript(
  transcriptEl: HTMLElement,
  options: ChatTranscriptOptions,
): void {
  const scroll = captureScrollAnchor(transcriptEl);
  transcriptEl.empty();
  const visibleMessages = options.messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => message.kind !== "compact-summary");

  if (visibleMessages.length === 0) {
    options.renderEmptyState(transcriptEl);
    return;
  }

  visibleMessages.forEach(({ message, index }) => {
    const messageEl = transcriptEl.createDiv({
      cls: `ixplorer-chat__message ixplorer-chat__message--${message.role}`,
    });
    const header = messageEl.createDiv({ cls: "ixplorer-chat__message-header" });
    header.createSpan({
      cls: "ixplorer-chat__message-label",
      text:
        message.role === "user"
          ? "You"
          : message.modelName || options.assistantLabel || "Assistant",
    });
    header.createSpan({
      cls: "ixplorer-chat__message-time",
      text: formatMessageTime(message.createdAt),
    });
    if (message.role === "user") {
      const editButton = header.createEl("button", {
        cls: "ixplorer-chat__message-edit",
        attr: {
          type: "button",
          "aria-label": "Edit question",
          title: "Edit question",
        },
      });
      setIcon(editButton, "pencil");
      editButton.addEventListener("click", (event) => {
        event.stopPropagation();
        options.onEditQuestion(index);
      });
    }
    const copyButton = header.createEl("button", {
      cls: "ixplorer-chat__message-copy",
      attr: {
        type: "button",
        "aria-label": "Copy message",
        title: "Copy message",
      },
    });
    setIcon(copyButton, "copy");
    copyButton.addEventListener("click", (event) => {
      event.stopPropagation();
      void copyToClipboard(messageDisplayContent(message));
    });
    if (shouldShowDiagnosticAction(message, options.isDebugMode)) {
      const diagnosticButton = header.createEl("button", {
        cls: "ixplorer-chat__message-diagnostic",
        attr: {
          type: "button",
          "aria-label": "Open diagnostic report",
          title: "Open diagnostic report",
        },
      });
      setIcon(diagnosticButton, "bug");
      diagnosticButton.addEventListener("click", (event) => {
        event.stopPropagation();
        options.onOpenDiagnosticReport(message.contextDiagnostics!);
      });
    }
    const contentEl = messageEl.createDiv({
      cls: `ixplorer-chat__message-content ixplorer-chat__message-content--${message.role}`,
    });
    if (message.role === "user" && options.editingMessageIndex === index) {
      renderQuestionEditor(contentEl, message, index, options);
    } else if (message.role === "assistant") {
      const progressEl = contentEl.createDiv({ cls: "ixplorer-chat__research-progress-host" });
      const hasWorkflow = renderWorkflowNodes(progressEl, message, options);
      contentEl.toggleClass("ixplorer-chat__message-content--workflow", hasWorkflow);
      if (message.isFallback) {
        renderFallbackBanner(contentEl, message.fallbackReason);
      }
      const citationRefs = buildCitationRefs(message.evidence ?? []);
      const answerEl = contentEl.createDiv({ cls: "ixplorer-chat__answer-content" });
      void MarkdownRenderer.render(
        options.app,
        messageMarkdownContent(message),
        answerEl,
        "",
        options.markdownContext,
      ).then(() => {
        renderInlineCitationAnchors(answerEl, citationRefs, options);
      });
    } else {
      contentEl.setText(messageDisplayContent(message));
    }

    if (message.role === "assistant" && message.evidence && message.evidence.length > 0) {
      renderCitationBlocks(messageEl, buildCitationRefs(message.evidence), {
        onOpenChunk: options.onOpenChunk,
        onHighlight: options.onHighlightCitation,
      });
    }
  });

  applyScrollAnchor(transcriptEl, scroll);
}

export function patchActiveAssistantMessage(
  transcriptEl: HTMLElement,
  options: ChatTranscriptOptions,
): boolean {
  const scroll = captureScrollAnchor(transcriptEl);
  const message = [...options.messages]
    .reverse()
    .find((candidate) => candidate.kind !== "compact-summary");
  if (message?.role !== "assistant") return false;
  const messageElements = transcriptEl.querySelectorAll<HTMLElement>(".ixplorer-chat__message");
  const messageEl = messageElements.item(messageElements.length - 1);
  if (!messageEl?.classList.contains("ixplorer-chat__message--assistant")) return false;
  const progressEl = messageEl.querySelector<HTMLElement>(".ixplorer-chat__research-progress-host");
  const answerEl = messageEl.querySelector<HTMLElement>(".ixplorer-chat__answer-content");
  if (!progressEl || !answerEl) return false;
  const contentEl = progressEl.parentElement;
  // Capture per-node open/expanded state from the live DOM before destroying it. The chain
  // items are recreated via spread on every update, so the DOM is the only source of truth
  // for which "Thinking" blocks the user opened and which tool cells they expanded.
  const uiState = captureWorkflowUiState(progressEl);
  progressEl.empty();
  const hasWorkflow = renderWorkflowNodes(progressEl, message, options, uiState);
  contentEl?.toggleClass("ixplorer-chat__message-content--workflow", hasWorkflow);
  const fallbackEl = messageEl.querySelector<HTMLElement>(".ixplorer-chat__fallback-notice");
  fallbackEl?.remove();
  if (message.isFallback) {
    const contentElForFallback = answerEl.parentElement;
    if (contentElForFallback) renderFallbackBanner(contentElForFallback, message.fallbackReason);
  }
  answerEl.empty();
  const citationRefs = buildCitationRefs(message.evidence ?? []);
  void MarkdownRenderer.render(
    options.app,
    messageMarkdownContent(message),
    answerEl,
    "",
    options.markdownContext,
  ).then(() => renderInlineCitationAnchors(answerEl, citationRefs, options));
  applyScrollAnchor(transcriptEl, scroll);
  return true;
}

// Auto-scroll only when the user is already at (or near) the bottom; if they have
// scrolled up to read earlier messages, preserve their position so re-renders and
// streaming updates don't yank the view away.
const STICK_TO_BOTTOM_THRESHOLD_PX = 60;

interface ScrollAnchor {
  stickToBottom: boolean;
  previousScrollTop: number;
}

function captureScrollAnchor(transcriptEl: HTMLElement): ScrollAnchor {
  const distanceFromBottom =
    transcriptEl.scrollHeight - transcriptEl.scrollTop - transcriptEl.clientHeight;
  return {
    stickToBottom: distanceFromBottom <= STICK_TO_BOTTOM_THRESHOLD_PX,
    previousScrollTop: transcriptEl.scrollTop,
  };
}

function applyScrollAnchor(transcriptEl: HTMLElement, anchor: ScrollAnchor): void {
  transcriptEl.scrollTop = anchor.stickToBottom
    ? transcriptEl.scrollHeight
    : anchor.previousScrollTop;
}

interface WorkflowUiState {
  openThinking: Set<string>;
  expandedCells: Set<string>;
}

function captureWorkflowUiState(hostEl: HTMLElement): WorkflowUiState {
  const openThinking = new Set<string>();
  hostEl.querySelectorAll<HTMLDetailsElement>("details[data-thinking-id]").forEach((el) => {
    if (el.open && el.dataset.thinkingId) openThinking.add(el.dataset.thinkingId);
  });
  const expandedCells = new Set<string>();
  hostEl.querySelectorAll<HTMLElement>("[data-tool-cell-id].is-expanded").forEach((el) => {
    if (el.dataset.toolCellId) expandedCells.add(el.dataset.toolCellId);
  });
  return { openThinking, expandedCells };
}

/**
 * Render reasoning, tool calls, and intermediate summaries as a single vertical
 * workflow that flows directly into the final answer. Returns whether any nodes
 * were rendered so the caller can mark the answer as the tail of the workflow.
 */
function renderWorkflowNodes(
  hostEl: HTMLElement,
  message: ChatDisplayMessage,
  options: ChatTranscriptOptions,
  uiState?: WorkflowUiState,
): boolean {
  const progress = message.researchProgress;
  const segments = progress?.reasoning.segments ?? [];
  const checkpoints = progress?.checkpoints ?? [];
  const chain = progress?.chain ?? [];
  const hasChain = chain.length > 0;
  if (segments.length === 0 && checkpoints.length === 0 && !hasChain) return false;
  const isStreaming = progress?.phase === "streaming";
  const listEl = hostEl.createDiv({ cls: "ixplorer-chat__workflow" });

  if (hasChain) {
    let activeReasoningId: string | undefined;
    if (isStreaming) {
      for (let i = chain.length - 1; i >= 0; i -= 1) {
        const item = chain[i];
        if (item.kind === "reasoning") {
          activeReasoningId = item.segmentId;
          break;
        }
      }
    }
    for (const item of chain) {
      if (item.kind === "reasoning") {
        renderThinkingNode(listEl, item.segmentId, item.content, {
          active: item.segmentId === activeReasoningId,
          options,
          uiState,
        });
      } else if (item.kind === "tool-call") {
        renderToolNode(listEl, item, options, uiState);
      }
    }
    return true;
  }

  segments.forEach((segment, index) => {
    renderThinkingNode(listEl, segment.id, segment.content, {
      active: isStreaming === true && index === segments.length - 1,
      options,
      uiState,
    });
  });
  for (const checkpoint of checkpoints) {
    renderSummaryNode(listEl, checkpoint.content, options);
  }
  return true;
}

const LONG_THINKING_CHARS = 280;

function isLongThinking(content: string): boolean {
  return content.length > LONG_THINKING_CHARS || content.split("\n").length > 4;
}

function renderThinkingNode(
  listEl: HTMLElement,
  id: string,
  content: string,
  context: { active: boolean; options: ChatTranscriptOptions; uiState?: WorkflowUiState },
): void {
  const { active, options, uiState } = context;
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
    const textEl = details.createDiv({ cls: "ixplorer-chat__workflow-text" });
    void MarkdownRenderer.render(options.app, content, textEl, "", options.markdownContext);
    return;
  }

  if (active) {
    body.createDiv({ cls: "ixplorer-chat__workflow-heading", text: "Thinking…" });
  }
  const textEl = body.createDiv({ cls: "ixplorer-chat__workflow-text" });
  void MarkdownRenderer.render(options.app, content, textEl, "", options.markdownContext);
}

function renderSummaryNode(
  listEl: HTMLElement,
  content: string,
  options: ChatTranscriptOptions,
): void {
  const node = listEl.createDiv({
    cls: "ixplorer-chat__workflow-node ixplorer-chat__workflow-node--summary",
  });
  node.createSpan({ cls: "ixplorer-chat__workflow-dot ixplorer-chat__workflow-dot--thinking" });
  const body = node.createDiv({ cls: "ixplorer-chat__workflow-body" });
  const textEl = body.createDiv({ cls: "ixplorer-chat__workflow-text" });
  void MarkdownRenderer.render(options.app, content, textEl, "", options.markdownContext);
}

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  search_index: "Search index",
  search_notes: "Search notes",
  search_web: "Search web",
  fetch_web_page: "Fetch web page",
  read_note: "Read note",
  get_active_note: "Active note",
  list_notes: "List notes",
  create_note: "Create note",
  update_note: "Edit note",
  delete_note: "Delete note",
  deep_search: "Deep research",
};

function renderToolNode(
  listEl: HTMLElement,
  item: Extract<ChainItem, { kind: "tool-call" }>,
  options: ChatTranscriptOptions,
  uiState?: WorkflowUiState,
): void {
  const view = describeToolCall({
    name: item.name,
    label: item.label,
    status: item.status,
    args: item.args,
    resultJson: item.resultJson,
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
    text: TOOL_DISPLAY_NAMES[item.name] ?? item.name,
  });
  if (view.intent) {
    head.createSpan({ cls: "ixplorer-chat__tool-intent", text: view.intent });
  }
  if (item.phase && item.status === "pending") {
    head.createSpan({ cls: "ixplorer-chat__tool-phase", text: item.phase });
  }
  if (view.inCell) {
    renderToolCell(body, `${item.id}:in`, "In", view.inCell, options, uiState);
  }
  if (view.outCell) {
    renderToolCell(body, `${item.id}:out`, "Out", view.outCell, options, uiState);
  }
  if (item.children && item.children.length > 0) {
    const nested = body.createDiv({ cls: "ixplorer-chat__workflow ixplorer-chat__workflow--nested" });
    for (const child of item.children) {
      if (child.kind === "tool-call") {
        renderToolNode(nested, child, options, uiState);
      }
    }
  }
}

const TOOL_CELL_COLLAPSED_PX = 160;

function renderToolCell(
  parentEl: HTMLElement,
  cellId: string,
  label: string,
  cell: ToolCell,
  options: ChatTranscriptOptions,
  uiState?: WorkflowUiState,
): void {
  const wrap = parentEl.createDiv({
    cls: "ixplorer-chat__tool-cell",
    attr: { "data-tool-cell-id": cellId },
  });
  if (uiState?.expandedCells.has(cellId)) wrap.addClass("is-expanded");
  const header = wrap.createDiv({ cls: "ixplorer-chat__tool-cell-header" });
  header.createSpan({ cls: "ixplorer-chat__tool-cell-label", text: label });
  const expandBtn = header.createEl("button", {
    cls: "ixplorer-chat__tool-cell-expand",
    attr: { type: "button", "aria-label": "Expand", title: "Expand" },
  });
  setIcon(expandBtn, "chevrons-up-down");
  const bodyEl = wrap.createDiv({ cls: "ixplorer-chat__tool-cell-body" });
  renderToolCellBody(bodyEl, cell, options);

  expandBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    const expanded = !wrap.hasClass("is-expanded");
    wrap.toggleClass("is-expanded", expanded);
    expandBtn.setAttr("aria-label", expanded ? "Collapse" : "Expand");
    expandBtn.setAttr("title", expanded ? "Collapse" : "Expand");
  });

  // Hide the toggle when the content already fits within the collapsed height.
  if (cell.kind !== "diff" || cell.hunks.length > 0) {
    if (bodyEl.scrollHeight <= TOOL_CELL_COLLAPSED_PX && !wrap.hasClass("is-expanded")) {
      expandBtn.addClass("is-hidden");
    }
  }
}

function renderToolCellBody(
  bodyEl: HTMLElement,
  cell: ToolCell,
  options: ChatTranscriptOptions,
): void {
  if (cell.kind === "code") {
    const pre = bodyEl.createEl("pre", { cls: "ixplorer-chat__tool-cell-code" });
    pre.createEl("code", { text: cell.text });
    return;
  }
  if (cell.kind === "text") {
    void MarkdownRenderer.render(options.app, cell.text, bodyEl, "", options.markdownContext);
    return;
  }
  const diffEl = bodyEl.createDiv({ cls: "ixplorer-chat__diff" });
  cell.hunks.forEach((hunk, index) => {
    if (index > 0) {
      diffEl.createDiv({ cls: "ixplorer-chat__diff-gap", text: "⋯" });
    }
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

function renderFallbackBanner(containerEl: HTMLElement, reason?: string): void {
  const reasonLabel: Record<string, string> = {
    "loop-detected": "Research stopped: detected repetitive tool calls.",
    "model-round-limit-exceeded": "Research stopped: maximum rounds exceeded.",
    "tool-call-limit-exceeded": "Research stopped: too many tool calls.",
    "tool-result-budget-exceeded": "Research stopped: result size limit exceeded.",
    "context-limit-exceeded": "Research stopped: context window limit reached.",
  };
  const bannerEl = containerEl.createDiv({ cls: "ixplorer-chat__fallback-notice" });
  const iconEl = bannerEl.createSpan({ cls: "ixplorer-chat__fallback-notice-icon" });
  setIcon(iconEl, "alert-triangle");
  const text = reason
    ? (reasonLabel[reason] ?? `Research stopped (${reason}).`)
    : "Research could not complete.";
  bannerEl.createSpan({
    cls: "ixplorer-chat__fallback-notice-text",
    text: `${text} The answer below is based on partial results.`,
  });
}

export function renderFollowUps(
  containerEl: HTMLElement,
  followUps: string[],
  onSelect: (question: string) => void,
): void {
  containerEl.empty();

  if (followUps.length === 0) {
    return;
  }

  containerEl.createEl("h3", { text: "Follow-ups" });
  const list = containerEl.createDiv({ cls: "ixplorer-chat__followup-list" });

  for (const question of followUps) {
    const button = list.createEl("button", {
      cls: "ixplorer-chat__followup",
      text: question,
      attr: { type: "button" },
    });
    button.addEventListener("click", () => onSelect(question));
  }
}

function renderQuestionEditor(
  containerEl: HTMLElement,
  message: ChatDisplayMessage,
  index: number,
  options: ChatTranscriptOptions,
): void {
  const textarea = containerEl.createEl("textarea", {
    cls: "ixplorer-chat__message-editor",
    attr: {
      rows: "2",
      "aria-label": "Edit question",
    },
  });
  textarea.value = message.content;
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      options.onEditQuestion(-1);
      return;
    }

    if (event.key !== "Enter" || event.shiftKey || event.isComposing) {
      return;
    }

    event.preventDefault();
    options.onSubmitEditedQuestion(index, textarea.value);
  });
}

function renderInlineCitationAnchors(
  containerEl: HTMLElement,
  refs: ChatCitationRef[],
  options: ChatTranscriptOptions,
): void {
  const refByChunkId = new Map<string, ChatCitationRef>();
  for (const ref of refs) {
    for (const chunkId of ref.chunkIds) {
      refByChunkId.set(chunkId, ref);
    }
  }

  const createAnchor = (ref: ChatCitationRef): HTMLElement => {
    const button = document.createElement("button");
    button.className = "ixplorer-chat__citation-anchor";
    button.type = "button";
    button.textContent = `[${ref.number}]`;
    button.setAttr("aria-label", `Open source ${ref.number}`);
    button.dataset.citationKey = ref.key;
    button.addEventListener("mouseenter", () => options.onOpenCitationPopover(button, ref));
    button.addEventListener("mouseleave", () => options.onScheduleCitationPopoverClose(ref.key));
    button.addEventListener("focus", () => options.onOpenCitationPopover(button, ref));
    button.addEventListener("blur", () => options.onScheduleCitationPopoverClose(ref.key));
    button.addEventListener("click", () => {
      options.onScrollCitationBlockIntoView(ref.key);
    });
    return button;
  };
  const replacementCount = replaceCitationTextNodes(containerEl, refByChunkId, createAnchor);

  if (replacementCount === 0) {
    appendFallbackCitationAnchors(containerEl, refs, createAnchor);
  }
}

function replaceCitationTextNodes(
  containerEl: HTMLElement,
  refByChunkId: Map<string, ChatCitationRef>,
  createAnchor: (ref: ChatCitationRef) => HTMLElement,
): number {
  const walker = document.createTreeWalker(containerEl, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let replacementCount = 0;

  while (walker.nextNode()) {
    if (walker.currentNode instanceof Text) {
      textNodes.push(walker.currentNode);
    }
  }

  for (const textNode of textNodes) {
    const text = textNode.nodeValue ?? "";
    const parts: Array<string | HTMLElement> = [];
    let lastIndex = 0;

    for (const match of text.matchAll(/\[([^\]\n]{8,})\]/g)) {
      const id = match[1];
      const ref = refByChunkId.get(id);

      if (match.index === undefined) {
        continue;
      }

      if (match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index));
      }
      if (ref) {
        parts.push(createAnchor(ref));
        replacementCount += 1;
      }
      lastIndex = match.index + match[0].length;
    }

    if (parts.length === 0) {
      continue;
    }

    if (lastIndex < text.length) {
      parts.push(stripRenderedCitationIds(text.slice(lastIndex)));
    }

    const fragment = document.createDocumentFragment();
    for (const part of parts) {
      fragment.append(part instanceof HTMLElement ? part : document.createTextNode(part));
    }
    textNode.replaceWith(fragment);
  }

  return replacementCount;
}

function appendFallbackCitationAnchors(
  containerEl: HTMLElement,
  refs: ChatCitationRef[],
  createAnchor: (ref: ChatCitationRef) => HTMLElement,
): void {
  const targets = Array.from(containerEl.querySelectorAll<HTMLElement>("p, li")).filter((element) =>
    Boolean(element.textContent?.trim()),
  );
  const fallbackTarget = targets.at(-1) ?? containerEl;

  for (const ref of refs) {
    const target = bestCitationTarget(targets, ref) ?? fallbackTarget;
    target.append(document.createTextNode(" "), createAnchor(ref));
  }
}

function bestCitationTarget(targets: HTMLElement[], ref: ChatCitationRef): HTMLElement | undefined {
  let best: { element: HTMLElement; score: number } | undefined;
  const sourceTokens = tokenSet(ref.chunk.text);

  if (sourceTokens.size === 0) {
    return undefined;
  }

  for (const target of targets) {
    const targetTokens = tokenSet(target.textContent ?? "");
    let score = 0;

    for (const token of targetTokens) {
      if (sourceTokens.has(token)) {
        score += 1;
      }
    }

    if (score > (best?.score ?? 0)) {
      best = { element: target, score };
    }
  }

  return best && best.score >= 2 ? best.element : undefined;
}

function tokenSet(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^\p{L}\p{N}_]+/u)
      .map((token) => token.trim())
      .filter((token) => token.length >= 5),
  );
}

function formatMessageTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
