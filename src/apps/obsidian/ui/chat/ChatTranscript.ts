import { App, Component, setIcon } from "obsidian";

import { ResearchAnswer } from "@core/answer";
import { ChainItem, ChatDisplayMessage, shouldShowDiagnosticAction } from "@core/conversation";
import { ContextDiagnostics } from "@core/diagnostics";
import type { DocumentImageResolver } from "@application/ports";
import { RetrievedChunk } from "@core/model";
import { copyToClipboard } from "@apps/obsidian/ui/shared/clipboard";
import {
  patchAssistantMessageContent,
  renderAssistantMessageContent,
} from "./assistantMessageRenderer";
import {
  ChatCitationRef,
  buildCitationRefs,
  renderCitationBlocks,
} from "./citations/CitationPopover";
import { citationEvidence } from "./citations/citationEvidence";
import { messageDisplayContent } from "./conversationFormatting";
import { disposeAnswerArtifacts } from "./artifacts";
import { disposeFetchTargetAnimations } from "./fetchTargetAnimator";

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
  onOpenToolOutput(item: Extract<ChainItem, { kind: "tool-call" }>): void;
  onHighlightCitation(key: string, highlighted: boolean): void;
  onOpenDiagnosticReport(diagnostics: ContextDiagnostics): void;
  onSaveAnswerToNewNote(answer: ResearchAnswer): void;
  onAppendAnswerToActiveNote(answer: ResearchAnswer): void;

  documentImages?: DocumentImageResolver;
}

export function renderChatTranscript(
  transcriptEl: HTMLElement,
  options: ChatTranscriptOptions,
): void {
  disposeChatTranscript(transcriptEl);
  const scroll = captureScrollAnchor(transcriptEl);
  transcriptEl.empty();
  const visibleMessages = options.messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => message.kind !== "compact-summary");
  if (visibleMessages.length === 0) {
    options.renderEmptyState(transcriptEl);
    return;
  }

  visibleMessages.forEach(({ message, index }) =>
    renderMessage(transcriptEl, message, index, options),
  );
  applyScrollAnchor(transcriptEl, scroll);
}

function renderMessage(
  transcriptEl: HTMLElement,
  message: ChatDisplayMessage,
  index: number,
  options: ChatTranscriptOptions,
): void {
  const messageEl = transcriptEl.createDiv({
    cls: `ixplorer-chat__message ixplorer-chat__message--${message.role}`,
  });
  renderMessageHeader(messageEl, message, index, options);
  const contentEl = messageEl.createDiv({
    cls: `ixplorer-chat__message-content ixplorer-chat__message-content--${message.role}`,
  });
  if (message.role === "user" && options.editingMessageIndex === index) {
    renderQuestionEditor(contentEl, message, index, options);
  } else if (message.role === "assistant") {
    renderAssistantMessageContent(contentEl, message, options);
  } else {
    renderUserMessageContent(contentEl, message);
  }
  renderMessageCitationBlocks(messageEl, message, options);
}

function renderMessageHeader(
  messageEl: HTMLElement,
  message: ChatDisplayMessage,
  index: number,
  options: ChatTranscriptOptions,
): void {
  const header = messageEl.createDiv({ cls: "ixplorer-chat__message-header" });
  header.createSpan({
    cls: "ixplorer-chat__message-label",
    text:
      message.role === "user" ? "You" : message.modelName || options.assistantLabel || "Assistant",
  });
  header.createSpan({
    cls: "ixplorer-chat__message-time",
    text: formatMessageTime(message.createdAt),
  });
  renderHeaderActions(header, message, index, options);
}

function renderMessageCitationBlocks(
  messageEl: HTMLElement,
  message: ChatDisplayMessage,
  options: ChatTranscriptOptions,
): void {
  const sourceEvidence = message.role === "assistant" ? citationEvidence(message) : [];
  if (sourceEvidence.length === 0) return;
  renderCitationBlocks(messageEl, buildCitationRefs(sourceEvidence), {
    onOpenChunk: options.onOpenChunk,
    onHighlight: options.onHighlightCitation,
  });
}

function renderUserMessageContent(containerEl: HTMLElement, message: ChatDisplayMessage): void {
  const contextPaths = message.contextPaths ?? [];
  if (contextPaths.length > 0) {
    const contextEl = containerEl.createDiv({
      cls: "ixplorer-chat__message-context",
      attr: { role: "list", "aria-label": "Context documents" },
    });
    for (const path of contextPaths) {
      const itemEl = contextEl.createDiv({
        cls: "ixplorer-chat__message-context-item",
        attr: { role: "listitem", title: path },
      });
      setIcon(
        itemEl.createSpan({
          cls: "ixplorer-chat__message-context-icon",
          attr: { "aria-hidden": "true" },
        }),
        path.endsWith("/") ? "folder" : "file-text",
      );
      itemEl.createSpan({
        cls: "ixplorer-chat__message-context-name",
        text: attachmentDisplayName(path),
      });
    }
  }
  containerEl.createDiv({
    cls: "ixplorer-chat__message-text",
    text: messageDisplayContent(message),
  });
}

function attachmentDisplayName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function renderHeaderActions(
  header: HTMLElement,
  message: ChatDisplayMessage,
  index: number,
  options: ChatTranscriptOptions,
): void {
  let actions: HTMLElement | null = null;
  const ensureActions = (): HTMLElement =>
    (actions ??= header.createDiv({ cls: "ixplorer-chat__message-actions" }));
  if (message.role === "user") {
    createMessageIconButton(
      ensureActions(),
      "pencil",
      "Edit question",
      "ixplorer-chat__message-edit",
      () => options.onEditQuestion(index),
    );
    createMessageIconButton(
      ensureActions(),
      "copy",
      "Copy message",
      "ixplorer-chat__message-copy",
      () => {
        void copyToClipboard(messageDisplayContent(message));
      },
    );
  }
  if (shouldShowDiagnosticAction(message, options.isDebugMode)) {
    createMessageIconButton(
      ensureActions(),
      "bug",
      "Open diagnostic report",
      "ixplorer-chat__message-diagnostic",
      () => options.onOpenDiagnosticReport(message.contextDiagnostics!),
    );
  }
}

function createMessageIconButton(
  containerEl: HTMLElement,
  icon: string,
  label: string,
  className: string,
  onClick: () => void,
): HTMLButtonElement {
  const button = containerEl.createEl("button", {
    cls: className,
    attr: { type: "button", "aria-label": label, title: label },
  });
  setIcon(button, icon);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
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
  if (!patchAssistantMessageContent(messageEl, message, options)) return false;
  applyScrollAnchor(transcriptEl, scroll);
  return true;
}

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

/** Releases everything the transcript owns before its DOM is emptied or replaced. */
export function disposeChatTranscript(transcriptEl: HTMLElement): void {
  disposeFetchTargetAnimations(transcriptEl);
  disposeAnswerArtifacts(transcriptEl);
}

export function renderFollowUps(
  containerEl: HTMLElement,
  followUps: string[],
  onSelect: (question: string) => void,
): void {
  containerEl.empty();
  if (followUps.length === 0) return;
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
    attr: { rows: "2", "aria-label": "Edit question" },
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
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    options.onSubmitEditedQuestion(index, textarea.value);
  });
}

function formatMessageTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
