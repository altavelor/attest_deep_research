import { App, Component, MarkdownRenderer, setIcon } from "obsidian";

import { RetrievedChunk } from "../shared/types";
import { copyToClipboard } from "./clipboard";
import { buildCitationRefs, ChatCitationRef, renderCitationBlocks } from "./CitationPopover";
import { stripRenderedCitationIds } from "./citationText";
import { ChatDisplayMessage } from "./rendering";
import { messageDisplayContent, messageMarkdownContent } from "./rendering";

export interface ChatTranscriptOptions {
  app: App;
  markdownContext: Component;
  messages: ChatDisplayMessage[];
  editingMessageIndex: number | null;
  assistantLabel: string;
  renderEmptyState(containerEl: HTMLElement): void;
  onEditQuestion(index: number): void;
  onSubmitEditedQuestion(index: number, value: string): void;
  onOpenCitationPopover(anchorEl: HTMLElement, ref: ChatCitationRef): void;
  onScheduleCitationPopoverClose(key: string): void;
  onScrollCitationBlockIntoView(key: string): void;
  onOpenChunk(chunk: RetrievedChunk): void;
  onHighlightCitation(key: string, highlighted: boolean): void;
}

export function renderChatTranscript(
  transcriptEl: HTMLElement,
  options: ChatTranscriptOptions,
): void {
  transcriptEl.empty();

  if (options.messages.length === 0) {
    options.renderEmptyState(transcriptEl);
    return;
  }

  options.messages.forEach((message, index) => {
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
    const contentEl = messageEl.createDiv({
      cls: `ixplorer-chat__message-content ixplorer-chat__message-content--${message.role}`,
    });
    if (message.role === "user" && options.editingMessageIndex === index) {
      renderQuestionEditor(contentEl, message, index, options);
    } else if (message.role === "assistant") {
      const citationRefs = buildCitationRefs(message.evidence ?? []);
      void MarkdownRenderer.render(
        options.app,
        messageMarkdownContent(message),
        contentEl,
        "",
        options.markdownContext,
      ).then(() => {
        renderInlineCitationAnchors(contentEl, citationRefs, options);
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
