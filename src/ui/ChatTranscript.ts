import { App, Component, MarkdownRenderer, setIcon } from "obsidian";

import { ContextDiagnostics, RetrievedChunk } from "../shared/types";
import { copyToClipboard } from "./clipboard";
import { buildCitationRefs, ChatCitationRef, renderCitationBlocks } from "./CitationPopover";
import { stripRenderedCitationIds } from "./citationText";
import { ChatDisplayMessage, ChainItem, shouldShowDiagnosticAction } from "./rendering";
import { messageDisplayContent, messageMarkdownContent } from "./rendering";

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
      text: message.role === "user" ? "You" : options.assistantLabel || "Assistant",
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
      renderReasoningSegments(progressEl, message, options);
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

  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

export function patchActiveAssistantMessage(
  transcriptEl: HTMLElement,
  options: ChatTranscriptOptions,
): boolean {
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
  // Capture current open/closed state from the live DOM before destroying the element.
  // The toggle listener mutates the *old* researchProgress object (captured in its closure),
  // but by the time we re-render, options.messages already holds a *new* object created via
  // spread — so the mutation is invisible to state. Reading the DOM directly is the source
  // of truth here.
  const liveDetails = progressEl.querySelector<HTMLDetailsElement>("details[data-reasoning-id]");
  if (liveDetails && message.researchProgress) {
    message.researchProgress.disclosure = liveDetails.open ? "user-open" : "user-closed";
  }
  progressEl.empty();
  renderReasoningSegments(progressEl, message, options);
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
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
  return true;
}

function renderReasoningSegments(
  containerEl: HTMLElement,
  message: ChatDisplayMessage,
  options: ChatTranscriptOptions,
): void {
  const progress = message.researchProgress;
  const legacySegments = message.reasoning ?? [];
  const segments = progress?.reasoning.segments ?? legacySegments;
  const checkpoints = progress?.checkpoints ?? [];
  const chain = progress?.chain ?? [];
  const hasChain = chain.length > 0;
  if (segments.length === 0 && checkpoints.length === 0 && !hasChain) return;
  const details = containerEl.createEl("details", {
    cls: "ixplorer-chat__reasoning",
    attr: { "data-reasoning-id": "research-progress" },
  });
  details.open = progress
    ? progress.disclosure === "user-open" ||
      (progress.disclosure === "auto" && progress.phase === "streaming")
    : message.reasoningOpen === true;
  const duration = progress?.reasoning.durationMs;
  const roundCount = new Set(checkpoints.map((checkpoint) => checkpoint.round)).size;
  const toolCallCount = chain.filter((item) => item.kind === "tool-call").length;
  const isStreaming = progress?.phase === "streaming";
  const summaryEl = details.createEl("summary", { cls: "ixplorer-chat__reasoning-summary" });
  if (isStreaming) {
    summaryEl.createSpan({ cls: "ixplorer-chat__reasoning-summary-label", text: "Thinking…" });
  } else {
    summaryEl.createSpan({ cls: "ixplorer-chat__reasoning-summary-label", text: "Research progress" });
    if (roundCount > 0) {
      const pillEl = summaryEl.createSpan({ cls: "ixplorer-chat__reasoning-pill" });
      setIcon(pillEl.createSpan(), "refresh-cw");
      pillEl.createSpan({ text: ` ${roundCount}` });
    }
    if (toolCallCount > 0) {
      const pillEl = summaryEl.createSpan({ cls: "ixplorer-chat__reasoning-pill" });
      setIcon(pillEl.createSpan(), "tool");
      pillEl.createSpan({ text: ` ${toolCallCount}` });
    }
    if (duration !== undefined) {
      summaryEl.createSpan({ cls: "ixplorer-chat__reasoning-duration", text: formatDuration(duration) });
    }
  }
  details.addEventListener("toggle", () => {
    if (progress) progress.disclosure = details.open ? "user-open" : "user-closed";
  });
  const reasoningEl = details.createDiv({ cls: "ixplorer-chat__reasoning-content" });
  if (hasChain) {
    renderChain(reasoningEl, chain, options);
  } else {
    for (const segment of segments) {
      const segmentEl = reasoningEl.createDiv({
        cls: "ixplorer-chat__reasoning-segment",
        attr: { "data-segment-id": segment.id },
      });
      void MarkdownRenderer.render(options.app, segment.content, segmentEl, "", options.markdownContext);
    }
    for (const checkpoint of checkpoints) {
      const checkpointEl = reasoningEl.createDiv({ cls: "ixplorer-chat__reasoning-checkpoint" });
      checkpointEl.createEl("strong", { text: `Provisional checkpoint ${checkpoint.round}` });
      void MarkdownRenderer.render(options.app, checkpoint.content, checkpointEl, "", options.markdownContext);
    }
  }
}

function renderChain(
  containerEl: HTMLElement,
  chain: ChainItem[],
  options: ChatTranscriptOptions,
): void {
  const chainEl = containerEl.createDiv({ cls: "ixplorer-chat__chain" });
  for (const item of chain) {
    if (item.kind === "tool-call") {
      const itemEl = chainEl.createDiv({
        cls: `ixplorer-chat__chain-tool-call ixplorer-chat__chain-tool-call--${item.status}`,
        attr: { "data-tool-id": item.id },
      });
      const iconEl = itemEl.createSpan({ cls: "ixplorer-chat__chain-tool-icon" });
      setIcon(iconEl, item.status === "failed" ? "x-circle" : item.status === "complete" ? "check-circle" : "loader");
      const labelEl = itemEl.createSpan({ cls: "ixplorer-chat__chain-tool-label", text: item.label });
      if (item.resultSummary) {
        labelEl.createSpan({ cls: "ixplorer-chat__chain-tool-result", text: ` · ${item.resultSummary}` });
      }
    } else if (item.kind === "reasoning") {
      const content = item.content;
      const isLong = content.length > 400;
      if (isLong) {
        const segDetails = chainEl.createEl("details", { cls: "ixplorer-chat__chain-reasoning" });
        segDetails.createEl("summary", { cls: "ixplorer-chat__chain-reasoning-summary", text: "Reasoning…" });
        const segEl = segDetails.createDiv({ cls: "ixplorer-chat__chain-reasoning-content" });
        void MarkdownRenderer.render(options.app, content, segEl, "", options.markdownContext);
      } else {
        const segEl = chainEl.createDiv({ cls: "ixplorer-chat__chain-reasoning" });
        void MarkdownRenderer.render(options.app, content, segEl, "", options.markdownContext);
      }
    }
  }
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
  const text = reason ? (reasonLabel[reason] ?? `Research stopped (${reason}).`) : "Research could not complete.";
  bannerEl.createSpan({ cls: "ixplorer-chat__fallback-notice-text", text: `${text} The answer below is based on partial results.` });
}

function formatDuration(durationMs: number): string {
  return durationMs < 1_000 ? `${durationMs} ms` : `${(durationMs / 1_000).toFixed(1)} s`;
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
