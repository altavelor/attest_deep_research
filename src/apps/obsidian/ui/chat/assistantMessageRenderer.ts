import { MarkdownRenderer, setIcon } from "obsidian";

import { shouldShowAnswerNoteActions } from "@core/conversation";
import { ChatDisplayMessage } from "@core/conversation";
import { messageMarkdownContent } from "@core/conversation";
import { linkifyUrlCitations, shortUrlCitationLabel } from "@application/use-cases/research";
import type { Translate } from "@adapters/i18n";
import { copyToClipboard } from "@apps/obsidian/ui/shared/clipboard";
import { buildCitationRefs } from "./citations/CitationPopover";
import { citationEvidence } from "./citations/citationEvidence";
import { renderInlineCitationAnchors } from "./citationAnchorRenderer";
import { messageDisplayContent } from "./conversationFormatting";
import type { ChatTranscriptOptions } from "./ChatTranscript";
import { RenderVersionTracker } from "./renderVersion";
import {
  captureWorkflowUiState,
  renderWorkflowNodes,
  WorkflowRenderContext,
} from "./workflowRenderer";
import { disposeFetchTargetAnimations } from "./fetchTargetAnimator";
import { disposeAnswerArtifacts, renderAnswerArtifacts } from "./artifacts";

const renderVersionsByAnswer = new WeakMap<HTMLElement, RenderVersionTracker>();

export function renderAssistantMessageContent(
  contentEl: HTMLElement,
  message: ChatDisplayMessage,
  options: ChatTranscriptOptions,
): void {
  const progressEl = contentEl.createDiv({ cls: "attest-chat__research-progress-host" });
  const hasWorkflow = renderWorkflowNodes(
    progressEl,
    message,
    createWorkflowRenderContext(options),
  );
  contentEl.toggleClass("attest-chat__message-content--workflow", hasWorkflow);
  if (message.isFallback) {
    renderFallbackBanner(contentEl, options.t, message.fallbackReason);
  }
  const answerEl = contentEl.createDiv({ cls: "attest-chat__answer-content" });
  renderAssistantAnswer(answerEl, message, options, hasWorkflow);
}

export function patchAssistantMessageContent(
  messageEl: HTMLElement,
  message: ChatDisplayMessage,
  options: ChatTranscriptOptions,
): boolean {
  const progressEl = messageEl.querySelector<HTMLElement>(".attest-chat__research-progress-host");
  const answerEl = messageEl.querySelector<HTMLElement>(".attest-chat__answer-content");
  if (!progressEl || !answerEl) return false;

  const contentEl = progressEl.parentElement;
  const uiState = captureWorkflowUiState(progressEl);
  disposeFetchTargetAnimations(progressEl);
  progressEl.empty();
  const hasWorkflow = renderWorkflowNodes(
    progressEl,
    message,
    createWorkflowRenderContext(options),
    uiState,
  );
  contentEl?.toggleClass("attest-chat__message-content--workflow", hasWorkflow);
  messageEl.querySelector<HTMLElement>(".attest-chat__fallback-notice")?.remove();
  if (message.isFallback && answerEl.parentElement) {
    renderFallbackBanner(answerEl.parentElement, options.t, message.fallbackReason);
  }
  disposeAnswerArtifacts(answerEl);
  answerEl.empty();
  renderAssistantAnswer(answerEl, message, options, hasWorkflow);
  return true;
}

function createWorkflowRenderContext(options: ChatTranscriptOptions): WorkflowRenderContext {
  return {
    app: options.app,
    markdownContext: options.markdownContext,
    isDebugMode: options.isDebugMode,
    t: options.t,
    onOpenToolOutput: options.onOpenToolOutput,
  };
}

function renderAssistantAnswer(
  answerEl: HTMLElement,
  message: ChatDisplayMessage,
  options: ChatTranscriptOptions,
  hasWorkflow: boolean,
): void {
  const citationRefs = buildCitationRefs(citationEvidence(message));
  const versionTracker = renderVersionsByAnswer.get(answerEl) ?? new RenderVersionTracker();
  renderVersionsByAnswer.set(answerEl, versionTracker);
  const renderVersion = versionTracker.next();
  renderAssistantAnswerHeader(answerEl, message, options, hasWorkflow);
  void MarkdownRenderer.render(
    options.app,
    answerMarkdown(message),
    answerEl,
    "",
    options.markdownContext,
  ).then(() => {
    if (!versionTracker.isCurrent(renderVersion)) return;
    renderInlineCitationAnchors(answerEl, citationRefs, options);
    renderAnswerArtifacts(answerEl, message.answer?.artifacts, {
      app: options.app,
      t: options.t,
      getDirection: options.getDirection,
      ...(options.documentImages ? { documentImages: options.documentImages } : {}),
    });
  });
}

/**
 * The model cites web sources with the `[url:https://…]` handle. While a run
 * streams the handle has not been resolved yet, so it becomes a short clickable
 * link to stay readable. A completed answer carries normalized handles that the
 * citation anchors render instead, and is left untouched.
 */
function answerMarkdown(message: ChatDisplayMessage): string {
  const content = messageMarkdownContent(message);
  if (!message.answer) {
    return linkifyUrlCitations(content, { label: shortUrlCitationLabel });
  }
  return content;
}

/**
 * The status dot terminates the workflow timeline, so it is rendered only for a
 * message that has one; an Instant run shows no timeline and no dot.
 */
function renderAssistantAnswerHeader(
  answerEl: HTMLElement,
  message: ChatDisplayMessage,
  options: ChatTranscriptOptions,
  hasWorkflow: boolean,
): void {
  const hasFinalAnswerText = messageMarkdownContent(message).trim().length > 0;
  if (!hasFinalAnswerText && !shouldShowAnswerNoteActions(message)) return;

  const header = answerEl.createDiv({ cls: "attest-chat__answer-header" });
  if (hasWorkflow) {
    header.createSpan({
      cls: "attest-chat__answer-status-dot",
      attr: { "aria-hidden": "true" },
    });
  }
  const actions = header.createDiv({ cls: "attest-chat__answer-actions" });
  createMessageIconButton(
    actions,
    "copy",
    options.t("chat.message.copy"),
    "attest-chat__message-copy",
    () => {
      void copyToClipboard(messageDisplayContent(message), options.t);
    },
  );
  if (shouldShowAnswerNoteActions(message)) {
    createMessageIconButton(
      actions,
      "file-plus-2",
      options.t("chat.answer.saveToNewNote"),
      "attest-chat__message-save-answer",
      () => options.onSaveAnswerToNewNote(message.answer!),
    );
    createMessageIconButton(
      actions,
      "file-input",
      options.t("chat.answer.appendToActiveNote"),
      "attest-chat__message-append-answer",
      () => options.onAppendAnswerToActiveNote(message.answer!),
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

function renderFallbackBanner(containerEl: HTMLElement, t: Translate, reason?: string): void {
  const reasonLabel: Record<string, string> = {
    "loop-detected": t("chat.fallback.loopDetected"),
    "model-round-limit-exceeded": t("chat.fallback.modelRoundLimitExceeded"),
    "tool-call-limit-exceeded": t("chat.fallback.toolCallLimitExceeded"),
    "tool-result-budget-exceeded": t("chat.fallback.toolResultBudgetExceeded"),
    "context-limit-exceeded": t("chat.fallback.contextLimitExceeded"),
  };
  const bannerEl = containerEl.createDiv({ cls: "attest-chat__fallback-notice" });
  const iconEl = bannerEl.createSpan({ cls: "attest-chat__fallback-notice-icon" });
  setIcon(iconEl, "alert-triangle");
  const text = reason
    ? (reasonLabel[reason] ?? t("chat.fallback.other", { reason }))
    : t("chat.fallback.incomplete");
  bannerEl.createSpan({
    cls: "attest-chat__fallback-notice-text",
    text: t("chat.fallback.partial", { reason: text }),
  });
}
