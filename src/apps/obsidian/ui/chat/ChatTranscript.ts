import { App, Component, setIcon } from "obsidian";

import { ResearchAnswer } from "@core/answer";
import {
  ChainItem,
  ChatDisplayMessage,
  messageMarkdownContent,
  shouldShowAnswerNoteActions,
  shouldShowDiagnosticAction,
} from "@core/conversation";
import { ContextDiagnostics } from "@core/diagnostics";
import type { DocumentImageResolver } from "@application/ports";
import { RetrievedChunk } from "@core/model";
import type { Translate } from "@adapters/i18n";
import { DEFAULT_LOCALE } from "@core/i18n";
import type { LocaleCode } from "@core/i18n";
import type { TextDirection } from "@core/i18n";
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
  t: Translate;
  locale?: LocaleCode;
  getDirection?(): TextDirection;
  renderEmptyState(containerEl: HTMLElement): void;
  onEditQuestion(index: number): void;
  onSubmitEditedQuestion(index: number, value: string): void;
  onOpenCitationPopover(anchorEl: HTMLElement, ref: ChatCitationRef): void;
  onScheduleCitationPopoverClose(key: string): void;
  onScrollCitationBlockIntoView(key: string): void;
  onOpenRegistryRevision?(revisionId: string): void;
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
    cls: `attest-chat__message attest-chat__message--${message.role}`,
    attr: { "data-message-id": message.id ?? message.createdAt },
  });
  renderMessageHeader(messageEl, message, index, options);
  const contentEl = messageEl.createDiv({
    cls: `attest-chat__message-content attest-chat__message-content--${message.role}`,
  });
  if (message.role === "user" && options.editingMessageIndex === index) {
    renderQuestionEditor(contentEl, message, index, options);
  } else if (message.role === "assistant") {
    renderAssistantMessageContent(contentEl, message, options);
  } else {
    renderUserMessageContent(contentEl, message, options.t);
  }
  renderMessageCitationBlocks(messageEl, message, options);
}

function renderMessageHeader(
  messageEl: HTMLElement,
  message: ChatDisplayMessage,
  index: number,
  options: ChatTranscriptOptions,
): void {
  const header = messageEl.createDiv({ cls: "attest-chat__message-header" });
  header.createSpan({
    cls: "attest-chat__message-label",
    text:
      message.role === "user"
        ? options.t("chat.message.you")
        : message.modelName || options.assistantLabel || options.t("chat.message.assistant"),
  });
  header.createSpan({
    cls: "attest-chat__message-time",
    text: formatMessageTime(message.createdAt, options.locale ?? DEFAULT_LOCALE),
  });
  renderHeaderActions(header, message, index, options);
}

/**
 * The sources block trails the message content, so a re-render replaces the
 * previous one in place and keeps its expanded state.
 */
function renderMessageCitationBlocks(
  messageEl: HTMLElement,
  message: ChatDisplayMessage,
  options: ChatTranscriptOptions,
): void {
  const existing = messageEl.querySelector<HTMLDetailsElement>(".attest-chat__citation-blocks");
  const wasOpen = existing?.open;
  existing?.remove();
  const sourceEvidence = message.role === "assistant" ? citationEvidence(message) : [];
  if (sourceEvidence.length === 0) return;
  renderCitationBlocks(messageEl, buildCitationRefs(sourceEvidence), {
    t: options.t,
    onOpenChunk: options.onOpenChunk,
    onHighlight: options.onHighlightCitation,
  });
  const rendered = messageEl.querySelector<HTMLDetailsElement>(".attest-chat__citation-blocks");
  if (rendered && wasOpen !== undefined) rendered.open = wasOpen;
}

function renderUserMessageContent(
  containerEl: HTMLElement,
  message: ChatDisplayMessage,
  t: Translate,
): void {
  const contextPaths = message.contextPaths ?? [];
  if (contextPaths.length > 0) {
    const contextEl = containerEl.createDiv({
      cls: "attest-chat__message-context",
      attr: { role: "list", "aria-label": t("chat.message.contextDocuments.aria") },
    });
    for (const path of contextPaths) {
      const itemEl = contextEl.createDiv({
        cls: "attest-chat__message-context-item",
        attr: { role: "listitem", title: path },
      });
      setIcon(
        itemEl.createSpan({
          cls: "attest-chat__message-context-icon",
          attr: { "aria-hidden": "true" },
        }),
        path.endsWith("/") ? "folder" : "file-text",
      );
      itemEl.createSpan({
        cls: "attest-chat__message-context-name",
        text: attachmentDisplayName(path),
      });
    }
  }
  containerEl.createDiv({
    cls: "attest-chat__message-text",
    text: messageDisplayContent(message),
  });
}

function attachmentDisplayName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/**
 * Every per-message action shares the header row: editing and copying for a
 * question, and copying, note actions, and the diagnostic report for an answer.
 */
function renderHeaderActions(
  header: HTMLElement,
  message: ChatDisplayMessage,
  index: number,
  options: ChatTranscriptOptions,
): void {
  let actions: HTMLElement | null = null;
  const ensureActions = (): HTMLElement =>
    (actions ??= header.createDiv({ cls: "attest-chat__message-actions" }));
  const createCopyButton = (): void => {
    createMessageIconButton(
      ensureActions(),
      "copy",
      options.t("chat.message.copy"),
      "attest-chat__message-copy",
      () => {
        void copyToClipboard(messageDisplayContent(message), options.t);
      },
    );
  };
  if (message.role === "user") {
    createMessageIconButton(
      ensureActions(),
      "pencil",
      options.t("chat.message.edit"),
      "attest-chat__message-edit",
      () => options.onEditQuestion(index),
    );
    createCopyButton();
  } else if (messageMarkdownContent(message).trim().length > 0) {
    createCopyButton();
  }
  if (message.role === "assistant" && shouldShowAnswerNoteActions(message)) {
    createMessageIconButton(
      ensureActions(),
      "file-plus-2",
      options.t("chat.answer.saveToNewNote"),
      "attest-chat__message-save-answer",
      () => options.onSaveAnswerToNewNote(message.answer!),
    );
    createMessageIconButton(
      ensureActions(),
      "file-input",
      options.t("chat.answer.appendToActiveNote"),
      "attest-chat__message-append-answer",
      () => options.onAppendAnswerToActiveNote(message.answer!),
    );
  }
  if (shouldShowDiagnosticAction(message, options.isDebugMode)) {
    createMessageIconButton(
      ensureActions(),
      "bug",
      options.t("chat.message.diagnostic"),
      "attest-chat__message-diagnostic",
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
  const index = lastVisibleMessageIndex(options.messages);
  const message = index >= 0 ? options.messages[index] : undefined;
  if (message?.role !== "assistant") return false;
  const messageElements = transcriptEl.querySelectorAll<HTMLElement>(".attest-chat__message");
  const messageEl = messageElements.item(messageElements.length - 1);
  if (!messageEl?.classList.contains("attest-chat__message--assistant")) return false;
  if (!patchAssistantMessageContent(messageEl, message, options)) return false;
  patchMessageHeaderActions(messageEl, message, index, options);
  renderMessageCitationBlocks(messageEl, message, options);
  applyScrollAnchor(transcriptEl, scroll);
  return true;
}

function lastVisibleMessageIndex(messages: ChatDisplayMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]!.kind !== "compact-summary") return index;
  }
  return -1;
}

function patchMessageHeaderActions(
  messageEl: HTMLElement,
  message: ChatDisplayMessage,
  index: number,
  options: ChatTranscriptOptions,
): void {
  const header = messageEl.querySelector<HTMLElement>(".attest-chat__message-header");
  if (!header) return;
  header.querySelector<HTMLElement>(".attest-chat__message-actions")?.remove();
  renderHeaderActions(header, message, index, options);
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
  t: Translate,
): void {
  containerEl.empty();
  if (followUps.length === 0) return;
  containerEl.createEl("h3", { text: t("chat.followUps.title") });
  const list = containerEl.createDiv({ cls: "attest-chat__followup-list" });
  for (const question of followUps) {
    const button = list.createEl("button", {
      cls: "attest-chat__followup",
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
    cls: "attest-chat__message-editor",
    attr: { rows: "2", "aria-label": options.t("chat.message.edit") },
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

function formatMessageTime(value: string, locale: LocaleCode): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}
