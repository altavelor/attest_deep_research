import { MarkdownRenderer, setIcon } from "obsidian";

import { shouldShowAnswerNoteActions } from "@core/conversation";
import { ChatDisplayMessage } from "@core/conversation";
import { messageMarkdownContent } from "@core/conversation";
import { linkifyUrlCitations, shortUrlCitationLabel } from "@application/use-cases/research";
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
  const progressEl = contentEl.createDiv({ cls: "ixplorer-chat__research-progress-host" });
  const hasWorkflow = renderWorkflowNodes(
    progressEl,
    message,
    createWorkflowRenderContext(options),
  );
  contentEl.toggleClass("ixplorer-chat__message-content--workflow", hasWorkflow);
  if (message.isFallback) {
    renderFallbackBanner(contentEl, message.fallbackReason);
  }
  const answerEl = contentEl.createDiv({ cls: "ixplorer-chat__answer-content" });
  renderAssistantAnswer(answerEl, message, options);
}

export function patchAssistantMessageContent(
  messageEl: HTMLElement,
  message: ChatDisplayMessage,
  options: ChatTranscriptOptions,
): boolean {
  const progressEl = messageEl.querySelector<HTMLElement>(".ixplorer-chat__research-progress-host");
  const answerEl = messageEl.querySelector<HTMLElement>(".ixplorer-chat__answer-content");
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
  contentEl?.toggleClass("ixplorer-chat__message-content--workflow", hasWorkflow);
  messageEl.querySelector<HTMLElement>(".ixplorer-chat__fallback-notice")?.remove();
  if (message.isFallback && answerEl.parentElement) {
    renderFallbackBanner(answerEl.parentElement, message.fallbackReason);
  }
  disposeAnswerArtifacts(answerEl);
  answerEl.empty();
  renderAssistantAnswer(answerEl, message, options);
  return true;
}

function createWorkflowRenderContext(options: ChatTranscriptOptions): WorkflowRenderContext {
  return {
    app: options.app,
    markdownContext: options.markdownContext,
    isDebugMode: options.isDebugMode,
    onOpenToolOutput: options.onOpenToolOutput,
  };
}

function renderAssistantAnswer(
  answerEl: HTMLElement,
  message: ChatDisplayMessage,
  options: ChatTranscriptOptions,
): void {
  const citationRefs = buildCitationRefs(citationEvidence(message));
  const versionTracker = renderVersionsByAnswer.get(answerEl) ?? new RenderVersionTracker();
  renderVersionsByAnswer.set(answerEl, versionTracker);
  const renderVersion = versionTracker.next();
  renderAssistantAnswerHeader(answerEl, message, options);
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
      ...(options.documentImages ? { documentImages: options.documentImages } : {}),
    });
  });
}

/**
 * The model cites web sources with the `[url:https://…]` handle. Left as-is it
 * renders as inert text, so it becomes a short clickable link before Markdown
 * rendering; unresolvable handles stay untouched.
 */
function answerMarkdown(message: ChatDisplayMessage): string {
  return linkifyUrlCitations(messageMarkdownContent(message), {
    label: shortUrlCitationLabel,
  });
}

function renderAssistantAnswerHeader(
  answerEl: HTMLElement,
  message: ChatDisplayMessage,
  options: ChatTranscriptOptions,
): void {
  const hasFinalAnswerText = messageMarkdownContent(message).trim().length > 0;
  if (!hasFinalAnswerText && !shouldShowAnswerNoteActions(message)) return;

  const header = answerEl.createDiv({ cls: "ixplorer-chat__answer-header" });
  header.createSpan({
    cls: "ixplorer-chat__answer-status-dot",
    attr: { "aria-hidden": "true" },
  });
  const actions = header.createDiv({ cls: "ixplorer-chat__answer-actions" });
  createMessageIconButton(actions, "copy", "Copy message", "ixplorer-chat__message-copy", () => {
    void copyToClipboard(messageDisplayContent(message));
  });
  if (shouldShowAnswerNoteActions(message)) {
    createMessageIconButton(
      actions,
      "file-plus-2",
      "Save answer to new note",
      "ixplorer-chat__message-save-answer",
      () => options.onSaveAnswerToNewNote(message.answer!),
    );
    createMessageIconButton(
      actions,
      "file-input",
      "Append answer to active note",
      "ixplorer-chat__message-append-answer",
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
