import { ItemView, MarkdownRenderer, Modal, Notice, TFile, WorkspaceLeaf, setIcon } from "obsidian";

import {
  SaveChatInput,
  SavedChat,
  SavedChatSettings,
  SavedChatSummary,
  inferChatTitle,
} from "../chat/ChatStore";
import { IndexingState } from "../indexing/IndexingService";
import {
  formatResearchAnswerAppendBlock,
  formatResearchAnswerNote,
  researchAnswerNotePath,
} from "../research/answerFormatter";
import { ResearchService, ResearchStreamEvent } from "../research/ResearchService";
import type { ResearchSearchMode } from "../research/ResearchService";
import { toUserMessage } from "../shared/errors";
import { Citation, ResearchAnswer, RetrievedChunk } from "../shared/types";
import { IndexControlActions, renderIndexControl } from "./IndexControl";
import { attachModelDropdown } from "./ModelDropdown";
import { ChatDisplayMessage, citationTarget, nextAssistantMessage } from "./rendering";
import { messageDisplayContent, messageMarkdownContent } from "./rendering";

export const IXPLORER_CHAT_VIEW_TYPE = "ixplorer-chat";

export interface IxplorerChatViewServices {
  createResearchService(): ResearchService;
  getIndexingState?(): IndexingState | undefined;
  subscribeToIndexingState?(listener: (state: IndexingState) => void): () => void;
  indexingActions?: IndexControlActions;
  isWebSearchEnabled(): boolean;
  getChatModel(): string;
  setChatModel(model: string): Promise<void>;
  getAvailableChatModels(): string[];
  getIndexProfiles(): Array<{ id: string; name: string }>;
  searchIndex(options: IndexSearchOptions): Promise<RetrievedChunk[]>;
  listSavedChats(): Promise<SavedChatSummary[]>;
  loadSavedChat(id: string): Promise<SavedChat | null>;
  saveChat(input: SaveChatInput): Promise<SavedChat>;
  isChatIndexControlShown(): boolean;
  setChatIndexControlShown(shown: boolean): Promise<void>;
}

export interface IndexSearchOptions {
  profileId: string;
  query: string;
  limit: number;
  minScore?: number;
  extension?: string;
}

type IxplorerPanel = "chat" | "indexSearch";

interface ChatCitationRef {
  number: number;
  chunk: RetrievedChunk;
  chunkIds: Set<string>;
  key: string;
}

export class IxplorerChatView extends ItemView {
  private readonly services: IxplorerChatViewServices;
  private messages: ChatDisplayMessage[] = [];
  private lastAnswer: ResearchAnswer | null = null;
  private attachedContextPaths: string[] = [];
  private currentChatSettings: SavedChatSettings;
  private currentChatId: string | null = null;
  private currentChatCreatedAt: string | null = null;
  private savedChatSummaries: SavedChatSummary[] = [];
  private historySearchQuery = "";
  private activePanel: IxplorerPanel = "chat";
  private indexSearchResults: RetrievedChunk[] = [];
  private indexSearchError: string | null = null;
  private isSearchingIndex = false;
  private isRunning = false;
  private shouldStopRunning = false;
  private editingMessageIndex: number | null = null;

  private transcriptEl: HTMLElement | null = null;
  private indexControlEl: HTMLElement | null = null;
  private followUpsEl: HTMLElement | null = null;
  private textareaEl: HTMLTextAreaElement | null = null;
  private progressStatusEl: HTMLElement | null = null;
  private modelInputEl: HTMLInputElement | null = null;
  private submitButtonEl: HTMLButtonElement | null = null;
  private submitButtonTooltipEl: HTMLElement | null = null;
  private searchModeEl: HTMLSelectElement | null = null;
  private deepResearchEl: HTMLInputElement | null = null;
  private attachedContextEl: HTMLElement | null = null;
  private indexSearchRootEl: HTMLElement | null = null;
  private indexSearchProfileEl: HTMLSelectElement | null = null;
  private indexSearchQueryEl: HTMLTextAreaElement | null = null;
  private indexSearchTopKEl: HTMLInputElement | null = null;
  private indexSearchMinScoreEl: HTMLInputElement | null = null;
  private indexSearchExtEl: HTMLInputElement | null = null;
  private indexSearchButtonEl: HTMLButtonElement | null = null;
  private indexSearchResultsEl: HTMLElement | null = null;
  private citationPopoverEl: HTMLElement | null = null;
  private citationPopoverCloseTimer: number | null = null;
  private historyPopoverEl: HTMLElement | null = null;
  private historyPopoverAnchorEl: HTMLElement | null = null;
  private readonly handleDocumentPointerDown = (event: PointerEvent): void => {
    this.closeHistoryPopoverOnOutsidePointer(event);
  };
  private unsubscribeIndexing: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, services: IxplorerChatViewServices) {
    super(leaf);
    this.services = services;
    this.currentChatSettings = this.createDefaultChatSettings();
  }

  getViewType(): string {
    return IXPLORER_CHAT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Ixplorer";
  }

  getIcon(): string {
    return "bot-message-square";
  }

  async onOpen(): Promise<void> {
    await this.refreshSavedChatSummaries();
    this.render();
  }

  async onClose(): Promise<void> {
    this.unsubscribeIndexing?.();
    this.unsubscribeIndexing = null;
    document.removeEventListener("pointerdown", this.handleDocumentPointerDown, true);
    this.closeCitationPopover();
    this.closeHistoryPopover();
    this.contentEl.empty();
  }

  private render(): void {
    this.contentEl.empty();
    this.contentEl.addClass("ixplorer-chat-view");

    const root = this.contentEl.createDiv({ cls: "ixplorer-chat" });
    const header = root.createDiv({ cls: "ixplorer-chat__header" });
    header.createEl("h2", { text: "Ixplorer" });
    this.renderPanelTabs(header);

    const chatPanel = root.createDiv({
      cls: `ixplorer-chat__panel${this.activePanel === "chat" ? "" : " is-hidden"}`,
    });
    const chatToolbar = chatPanel.createDiv({ cls: "ixplorer-chat__toolbar" });
    this.renderChatWindowActions(chatToolbar);

    this.transcriptEl = chatPanel.createDiv({
      cls: "ixplorer-chat__transcript",
      attr: { role: "log", "aria-live": "polite" },
    });

    const results = chatPanel.createDiv({ cls: "ixplorer-chat__results" });
    this.followUpsEl = results.createDiv({ cls: "ixplorer-chat__followups" });

    chatPanel.createEl("form", { cls: "ixplorer-chat__form" }, (form) => {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        void this.submitQuestion();
      });

      this.progressStatusEl = form.createDiv({
        cls: "ixplorer-chat__progress-status",
        attr: { "aria-live": "polite" },
      });

      this.textareaEl = form.createEl("textarea", {
        cls: "ixplorer-chat__input",
        attr: {
          rows: "3",
          placeholder: "Ask across your vault",
          "aria-label": "Research question",
        },
      });
      this.textareaEl.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || event.shiftKey || event.isComposing) {
          return;
        }

        event.preventDefault();
        void this.submitQuestion();
      });

      const modelRow = form.createDiv({ cls: "ixplorer-chat__model-row" });
      const attachButton = modelRow.createEl("button", {
        cls: "ixplorer-chat__icon-button",
        attr: {
          type: "button",
          "aria-label": "Attach context documents",
          title: "Attach context documents",
        },
      });
      setIcon(attachButton, "paperclip");
      attachButton.addEventListener("click", () => {
        this.openContextPicker();
      });
      modelRow.createEl("label", { text: "Model", attr: { for: "ixplorer-chat-model" } });
      this.modelInputEl = modelRow.createEl("input", {
        cls: "ixplorer-chat__model-input",
        attr: {
          id: "ixplorer-chat-model",
          type: "text",
          placeholder: "Chat model",
        },
      });
      this.modelInputEl.value = this.currentChatSettings.model;
      this.modelInputEl.addEventListener("change", () => {
        void this.updateChatModel(this.modelInputEl?.value ?? "");
      });
      attachModelDropdown({
        inputEl: this.modelInputEl,
        containerEl: modelRow,
        getModels: () => this.services.getAvailableChatModels(),
        emptyText: "Refresh models in settings",
        onSelect: (model) => this.updateChatModel(model),
      });
      this.attachedContextEl = form.createDiv({ cls: "ixplorer-chat__attachments" });
      this.renderAttachedContext();

      const searchModeLabel = modelRow.createEl("label", {
        cls: "ixplorer-chat__search-mode",
        attr: { for: "ixplorer-chat-search-mode" },
      });
      searchModeLabel.createSpan({ text: "Search" });
      this.searchModeEl = searchModeLabel.createEl("select", {
        cls: "ixplorer-chat__search-mode-select",
        attr: {
          id: "ixplorer-chat-search-mode",
          "aria-label": "Search mode",
        },
      });
      createSearchModeOptions(this.searchModeEl);
      this.searchModeEl.value = this.currentChatSettings.searchMode;
      this.searchModeEl.addEventListener("change", () => {
        void this.updateSearchMode(this.getSearchMode());
        this.updateSubmitAvailability();
        this.updateDeepResearchAvailability();
      });

      const deepResearchLabel = modelRow.createEl("label", {
        cls: "ixplorer-chat__deep-research",
        attr: {
          title: "Use deeper multi-query web research",
        },
      });
      this.deepResearchEl = deepResearchLabel.createEl("input", {
        attr: {
          type: "checkbox",
          "aria-label": "Deep web research",
        },
      });
      this.deepResearchEl.checked = this.currentChatSettings.deepResearch === true;
      this.deepResearchEl.addEventListener("change", () => {
        void this.updateDeepResearch(this.deepResearchEl?.checked === true);
      });
      deepResearchLabel.createSpan({ text: "Deep" });
      this.updateDeepResearchAvailability();

      this.submitButtonTooltipEl = modelRow.createSpan({
        cls: "ixplorer-chat__submit-tooltip",
      });
      this.submitButtonEl = this.submitButtonTooltipEl.createEl("button", {
        cls: "mod-cta ixplorer-chat__submit",
        text: "Ask",
        attr: { type: "button" },
      });
      this.submitButtonEl.addEventListener("click", () => {
        if (this.isRunning) {
          this.stopRunningQuestion();
          return;
        }

        void this.submitQuestion();
      });
      this.updateSubmitAvailability();
    });

    this.indexSearchRootEl = root.createDiv({
      cls: `ixplorer-index-search${this.activePanel === "indexSearch" ? "" : " is-hidden"}`,
    });
    this.renderIndexSearchPanel();

    this.unsubscribeIndexing?.();
    this.unsubscribeIndexing =
      this.services.subscribeToIndexingState?.(() => {
        this.renderIndexControl();
      }) ?? null;
    this.renderIndexControl();
    this.renderMessages();
    this.renderAnswerDetails();
  }

  private renderPanelTabs(containerEl: HTMLElement): void {
    const tabs = containerEl.createDiv({ cls: "ixplorer-chat__tabs", attr: { role: "tablist" } });
    this.createPanelTab(tabs, "chat", "Chat");
    this.createPanelTab(tabs, "indexSearch", "Index search");
  }

  private createPanelTab(containerEl: HTMLElement, panel: IxplorerPanel, label: string): void {
    const button = containerEl.createEl("button", {
      cls: `ixplorer-chat__tab${this.activePanel === panel ? " is-active" : ""}`,
      text: label,
      attr: {
        type: "button",
        role: "tab",
        "aria-selected": String(this.activePanel === panel),
      },
    });
    button.addEventListener("click", () => {
      this.activePanel = panel;
      this.render();
    });
  }

  private renderChatWindowActions(containerEl: HTMLElement): void {
    const actions = containerEl.createDiv({ cls: "ixplorer-chat__window-actions" });
    const historyButton = this.createHeaderIconButton(actions, {
      icon: "history",
      label: "Chats history",
      disabled: false,
      onClick: () => {
        void this.toggleHistoryPopover(historyButton);
      },
    });
    this.createHeaderIconButton(actions, {
      icon: "message-square-plus",
      label: "New chat",
      disabled: false,
      onClick: () => {
        void this.startNewChat();
      },
    });
    this.createHeaderIconButton(actions, {
      icon: "file-plus-2",
      label: "Save answer to new note",
      disabled: this.lastAnswer === null,
      onClick: () => void this.saveAnswerToNewNote(),
    });
    this.createHeaderIconButton(actions, {
      icon: "file-input",
      label: "Append answer to active note",
      disabled: this.lastAnswer === null,
      onClick: () => void this.appendAnswerToActiveNote(),
    });
  }

  private createHeaderIconButton(
    containerEl: HTMLElement,
    options: {
      icon: string;
      label: string;
      disabled: boolean;
      onClick: () => void;
    },
  ): HTMLButtonElement {
    const button = containerEl.createEl("button", {
      cls: "ixplorer-chat__icon-button",
      attr: {
        type: "button",
        "aria-label": options.label,
        title: options.label,
      },
    });
    button.disabled = options.disabled;
    setIcon(button, options.icon);
    button.addEventListener("click", options.onClick);
    return button;
  }

  private async startNewChat(): Promise<void> {
    await this.saveCurrentChat();
    this.messages = [];
    this.lastAnswer = null;
    this.attachedContextPaths = [];
    this.currentChatSettings = this.createDefaultChatSettings();
    this.currentChatId = null;
    this.currentChatCreatedAt = null;
    this.editingMessageIndex = null;
    this.closeHistoryPopover();
    await this.refreshSavedChatSummaries();
    this.render();
  }

  private openContextPicker(): void {
    const files = this.app.vault
      .getFiles()
      .filter((file) => isContextDocumentPath(file.path))
      .sort((left, right) => left.path.localeCompare(right.path));
    new ContextDocumentPickerModal(this.app, {
      files,
      selectedPaths: this.attachedContextPaths,
      onSubmit: (paths) => {
        this.attachedContextPaths = paths;
        this.renderAttachedContext();
        void this.saveCurrentChat();
      },
    }).open();
  }

  private renderAttachedContext(): void {
    if (!this.attachedContextEl) {
      return;
    }

    this.attachedContextEl.empty();

    for (const path of this.attachedContextPaths) {
      const chip = this.attachedContextEl.createSpan({ cls: "ixplorer-chat__attachment" });
      chip.createSpan({ text: path });
      const removeButton = chip.createEl("button", {
        attr: {
          type: "button",
          "aria-label": `Remove ${path}`,
          title: `Remove ${path}`,
        },
      });
      setIcon(removeButton, "x");
      removeButton.addEventListener("click", () => {
        this.attachedContextPaths = this.attachedContextPaths.filter(
          (candidate) => candidate !== path,
        );
        this.renderAttachedContext();
        void this.saveCurrentChat();
      });
    }
  }

  private renderIndexControl(): void {
    if (!this.indexControlEl) {
      return;
    }

    if (this.activePanel !== "indexSearch") {
      this.indexControlEl.empty();
      return;
    }

    renderIndexControl(this.indexControlEl, {
      compact: true,
      state: this.services.getIndexingState?.(),
      actions: this.services.indexingActions ?? {
        start: () => undefined,
        pause: () => undefined,
        resume: () => undefined,
        rebuild: () => undefined,
      },
    });
  }

  private renderMessages(): void {
    if (!this.transcriptEl) {
      return;
    }

    const transcriptEl = this.transcriptEl;
    transcriptEl.empty();

    if (this.messages.length === 0) {
      this.renderEmptyChatState(transcriptEl);
      return;
    }

    this.messages.forEach((message, index) => {
      const messageEl = transcriptEl.createDiv({
        cls: `ixplorer-chat__message ixplorer-chat__message--${message.role}`,
      });
      const header = messageEl.createDiv({ cls: "ixplorer-chat__message-header" });
      header.createSpan({
        cls: "ixplorer-chat__message-label",
        text: message.role === "user" ? "You" : this.services.getChatModel() || "Assistant",
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
          this.editingMessageIndex = index;
          this.renderMessages();
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
      if (message.role === "user" && this.editingMessageIndex === index) {
        this.renderQuestionEditor(contentEl, message, index);
      } else if (message.role === "assistant") {
        const citationRefs = buildCitationRefs(message.evidence ?? []);
        void MarkdownRenderer.render(
          this.app,
          messageMarkdownContent(message),
          contentEl,
          "",
          this,
        ).then(() => {
          this.renderInlineCitationAnchors(contentEl, citationRefs);
        });
      } else {
        contentEl.setText(messageDisplayContent(message));
      }

      if (message.role === "assistant" && message.evidence && message.evidence.length > 0) {
        this.renderCitationBlocks(messageEl, buildCitationRefs(message.evidence));
      }
    });

    transcriptEl.scrollTop = transcriptEl.scrollHeight;
  }

  private renderQuestionEditor(
    containerEl: HTMLElement,
    message: ChatDisplayMessage,
    index: number,
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
        this.editingMessageIndex = null;
        this.renderMessages();
        return;
      }

      if (event.key !== "Enter" || event.shiftKey || event.isComposing) {
        return;
      }

      event.preventDefault();
      void this.submitEditedQuestion(index, textarea.value);
    });
  }

  private renderAnswerDetails(): void {
    this.renderFollowUps(this.lastAnswer?.followUpQuestions ?? []);
  }

  private renderInlineCitationAnchors(containerEl: HTMLElement, refs: ChatCitationRef[]): void {
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
      button.addEventListener("mouseenter", () => this.openCitationPopover(button, ref));
      button.addEventListener("mouseleave", () => this.scheduleCitationPopoverClose(ref.key));
      button.addEventListener("focus", () => this.openCitationPopover(button, ref));
      button.addEventListener("blur", () => this.scheduleCitationPopoverClose(ref.key));
      button.addEventListener("click", () => {
        this.scrollCitationBlockIntoView(ref.key);
      });
      return button;
    };
    const replacementCount = replaceCitationTextNodes(containerEl, refByChunkId, createAnchor);

    if (replacementCount === 0) {
      appendFallbackCitationAnchors(containerEl, refs, createAnchor);
    }
  }

  private renderCitationBlocks(containerEl: HTMLElement, refs: ChatCitationRef[]): void {
    const details = containerEl.createEl("details", {
      cls: "ixplorer-chat__citation-blocks",
    });
    details.open = refs.length <= 3;
    details.createEl("summary", {
      cls: "ixplorer-chat__citation-summary",
      text: `Sources used (${refs.length})`,
    });

    for (const ref of refs) {
      const block = details.createDiv({
        cls: "ixplorer-chat__citation-block",
        attr: { role: "link", tabindex: "0", "data-citation-key": ref.key },
      });
      block.addEventListener("click", () => {
        void this.openRetrievedChunk(ref.chunk);
      });
      block.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }

        event.preventDefault();
        void this.openRetrievedChunk(ref.chunk);
      });
      block.addEventListener("mouseenter", () => this.setCitationHighlight(ref.key, true));
      block.addEventListener("mouseleave", () => this.setCitationHighlight(ref.key, false));
      block.addEventListener("focus", () => this.setCitationHighlight(ref.key, true));
      block.addEventListener("blur", () => this.setCitationHighlight(ref.key, false));
      const header = block.createDiv({ cls: "ixplorer-chat__citation-block-header" });
      header.createSpan({ cls: "ixplorer-chat__citation-number", text: String(ref.number) });
      header.createSpan({
        cls: "ixplorer-chat__citation-block-source",
        text: formatIndexSearchCitation(ref.chunk),
      });
      const copyButton = header.createEl("button", {
        cls: "ixplorer-chat__citation-copy",
        attr: {
          type: "button",
          "aria-label": "Copy citation text",
          title: "Copy citation text",
        },
      });
      setIcon(copyButton, "copy");
      copyButton.addEventListener("click", (event) => {
        event.stopPropagation();
        void copyToClipboard(ref.chunk.text);
      });
      block.createDiv({
        cls: "ixplorer-chat__citation-block-text",
        text: ref.chunk.text,
      });
    }
  }

  private renderEmptyChatState(containerEl: HTMLElement): void {
    const empty = containerEl.createDiv({ cls: "ixplorer-chat__empty-state" });
    const header = empty.createDiv({ cls: "ixplorer-chat__empty-header" });
    header.createEl("h3", { text: "Saved chats" });
    header.createSpan({
      cls: "ixplorer-chat__empty-count",
      text: `${this.savedChatSummaries.length} saved`,
    });

    if (this.savedChatSummaries.length === 0) {
      empty.createDiv({
        cls: "ixplorer-chat__empty-note",
        text: "No saved chats yet.",
      });
      return;
    }

    const list = empty.createDiv({ cls: "ixplorer-chat__saved-list" });
    const visibleChats = this.savedChatSummaries.slice(0, 5);
    for (const chat of visibleChats) {
      this.renderSavedChatRow(list, chat, "ixplorer-chat__saved-item");
    }

    const hiddenCount = this.savedChatSummaries.length - visibleChats.length;
    if (hiddenCount > 0) {
      const viewAll = list.createEl("button", {
        cls: "ixplorer-chat__saved-view-all",
        attr: { type: "button" },
      });
      viewAll.createSpan({ text: "View all" });
      viewAll.createSpan({ text: String(hiddenCount) });
      viewAll.addEventListener("click", () => {
        void this.toggleHistoryPopover(viewAll);
      });
    }
  }

  private renderSavedChatRow(
    containerEl: HTMLElement,
    chat: SavedChatSummary,
    className: string,
  ): HTMLButtonElement {
    const button = containerEl.createEl("button", {
      cls: className,
      attr: { type: "button" },
    });
    const title = button.createSpan({ cls: "ixplorer-chat__saved-title", text: chat.title });
    title.setAttr("title", chat.title);
    const meta = button.createSpan({ cls: "ixplorer-chat__saved-meta" });
    meta.createSpan({ text: formatMessageCount(chat.messageCount) });
    meta.createSpan({ text: formatRelativeTime(chat.updatedAt) });
    button.addEventListener("click", () => {
      void this.loadSavedChat(chat.id);
    });
    return button;
  }

  private setCitationHighlight(key: string, highlighted: boolean): void {
    this.contentEl
      .querySelectorAll<HTMLElement>(`[data-citation-key="${cssEscape(key)}"]`)
      .forEach((element) => element.toggleClass("is-highlighted", highlighted));
  }

  private openCitationPopover(anchorEl: HTMLElement, ref: ChatCitationRef): void {
    this.cancelCitationPopoverClose();
    this.setCitationHighlight(ref.key, true);
    this.citationPopoverEl?.remove();
    const popover = this.contentEl.createDiv({
      cls: "ixplorer-chat__citation-popover",
      attr: { "data-citation-key": ref.key },
    });
    popover.addEventListener("mouseenter", () => {
      this.cancelCitationPopoverClose();
      this.setCitationHighlight(ref.key, true);
    });
    popover.addEventListener("mouseleave", () => this.scheduleCitationPopoverClose(ref.key));
    popover.addEventListener("focusin", () => {
      this.cancelCitationPopoverClose();
      this.setCitationHighlight(ref.key, true);
    });
    popover.addEventListener("focusout", () => this.scheduleCitationPopoverClose(ref.key));
    this.renderCitationPopoverContent(popover, ref);
    this.citationPopoverEl = popover;
    this.positionCitationPopover(anchorEl, popover);
  }

  private renderCitationPopoverContent(containerEl: HTMLElement, ref: ChatCitationRef): void {
    const block = containerEl.createDiv({
      cls: "ixplorer-chat__citation-popover-card",
      attr: { role: "link", tabindex: "0" },
    });
    block.addEventListener("click", () => {
      void this.openRetrievedChunk(ref.chunk);
    });
    block.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();
      void this.openRetrievedChunk(ref.chunk);
    });
    const header = block.createDiv({ cls: "ixplorer-chat__citation-block-header" });
    header.createSpan({ cls: "ixplorer-chat__citation-number", text: String(ref.number) });
    header.createSpan({
      cls: "ixplorer-chat__citation-block-source",
      text: formatIndexSearchCitation(ref.chunk),
    });
    const copyButton = header.createEl("button", {
      cls: "ixplorer-chat__citation-copy",
      attr: {
        type: "button",
        "aria-label": "Copy citation text",
        title: "Copy citation text",
      },
    });
    setIcon(copyButton, "copy");
    copyButton.addEventListener("click", (event) => {
      event.stopPropagation();
      void copyToClipboard(ref.chunk.text);
    });
    block.createDiv({
      cls: "ixplorer-chat__citation-block-text",
      text: ref.chunk.text,
    });
  }

  private positionCitationPopover(anchorEl: HTMLElement, popoverEl: HTMLElement): void {
    const anchorRect = anchorEl.getBoundingClientRect();
    const hostRect = this.contentEl.getBoundingClientRect();
    const popoverRect = popoverEl.getBoundingClientRect();
    const gap = 8;
    const left = Math.min(
      Math.max(anchorRect.left - hostRect.left, gap),
      Math.max(gap, hostRect.width - popoverRect.width - gap),
    );
    const topBelow = anchorRect.bottom - hostRect.top + gap;
    const topAbove = anchorRect.top - hostRect.top - popoverRect.height - gap;
    const top =
      topBelow + popoverRect.height <= hostRect.height || topAbove < gap
        ? topBelow
        : Math.max(gap, topAbove);

    popoverEl.style.left = `${left}px`;
    popoverEl.style.top = `${top}px`;
  }

  private scheduleCitationPopoverClose(key: string): void {
    this.cancelCitationPopoverClose();
    this.citationPopoverCloseTimer = window.setTimeout(() => {
      this.setCitationHighlight(key, false);
      this.closeCitationPopover();
    }, 180);
  }

  private cancelCitationPopoverClose(): void {
    if (this.citationPopoverCloseTimer !== null) {
      window.clearTimeout(this.citationPopoverCloseTimer);
      this.citationPopoverCloseTimer = null;
    }
  }

  private closeCitationPopover(): void {
    this.cancelCitationPopoverClose();
    const key = this.citationPopoverEl?.dataset.citationKey;
    if (key) {
      this.setCitationHighlight(key, false);
    }
    this.citationPopoverEl?.remove();
    this.citationPopoverEl = null;
  }

  private scrollCitationBlockIntoView(key: string): void {
    const block = this.contentEl.querySelector<HTMLElement>(
      `.ixplorer-chat__citation-block[data-citation-key="${cssEscape(key)}"]`,
    );
    const details = block?.closest("details");
    if (details instanceof HTMLDetailsElement) {
      details.open = true;
    }
    block?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    this.setCitationHighlight(key, true);
    window.setTimeout(() => this.setCitationHighlight(key, false), 900);
  }

  private renderIndexSearchPanel(): void {
    if (!this.indexSearchRootEl) {
      return;
    }

    this.indexSearchRootEl.empty();
    this.indexControlEl = this.indexSearchRootEl.createDiv({
      cls: "ixplorer-index-search__index-control",
    });
    this.renderIndexControl();
    const profiles = this.services.getIndexProfiles();
    const form = this.indexSearchRootEl.createEl("form", { cls: "ixplorer-index-search__form" });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.submitIndexSearch();
    });

    this.indexSearchProfileEl = form.createEl("select", {
      cls: "ixplorer-index-search__profile",
      attr: { "aria-label": "Index profile" },
    });
    for (const profile of profiles) {
      this.indexSearchProfileEl.createEl("option", {
        text: profile.name,
        value: profile.id,
      });
    }

    const filters = form.createDiv({ cls: "ixplorer-index-search__filters" });
    this.indexSearchTopKEl = createLabeledInput(filters, {
      label: "Top K",
      value: "5",
      type: "number",
      min: "1",
      max: "50",
    });
    this.indexSearchMinScoreEl = createLabeledInput(filters, {
      label: "Min score",
      value: "0.3",
      type: "number",
      min: "0",
      max: "1",
      step: "0.05",
    });
    this.indexSearchExtEl = createLabeledInput(filters, {
      label: "Ext",
      value: "",
      type: "text",
      placeholder: "pdf, md",
    });

    const queryRow = form.createDiv({ cls: "ixplorer-index-search__query-row" });
    this.indexSearchQueryEl = queryRow.createEl("textarea", {
      cls: "ixplorer-index-search__query",
      attr: {
        rows: "2",
        placeholder: "Enter search query...",
        "aria-label": "Index search query",
      },
    });
    this.indexSearchQueryEl.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) {
        return;
      }

      event.preventDefault();
      void this.submitIndexSearch();
    });
    this.indexSearchButtonEl = queryRow.createEl("button", {
      cls: "ixplorer-index-search__button",
      attr: {
        type: "submit",
        "aria-label": "Search index",
        title: "Search index",
      },
    });
    setIcon(this.indexSearchButtonEl, "search");

    this.indexSearchResultsEl = this.indexSearchRootEl.createDiv({
      cls: "ixplorer-index-search__results",
      attr: { role: "list" },
    });
    this.renderIndexSearchResults();
  }

  private renderIndexSearchResults(): void {
    if (!this.indexSearchResultsEl) {
      return;
    }

    this.indexSearchResultsEl.empty();

    if (this.indexSearchError) {
      this.indexSearchResultsEl.createDiv({
        cls: "ixplorer-index-search__empty",
        text: this.indexSearchError,
      });
      return;
    }

    if (this.isSearchingIndex) {
      this.indexSearchResultsEl.createDiv({
        cls: "ixplorer-index-search__empty",
        text: "Searching index...",
      });
      return;
    }

    if (this.indexSearchResults.length === 0) {
      this.indexSearchResultsEl.createDiv({
        cls: "ixplorer-index-search__empty",
        text: "No results yet.",
      });
      return;
    }

    for (const chunk of this.indexSearchResults) {
      const item = this.indexSearchResultsEl.createDiv({
        cls: "ixplorer-index-search__result",
        attr: { role: "listitem" },
      });
      const header = item.createDiv({ cls: "ixplorer-index-search__result-header" });
      const citation = formatIndexSearchCitation(chunk);
      const openButton = header.createEl("button", {
        cls: "ixplorer-index-search__result-title",
        text: citation,
        attr: { type: "button" },
      });
      openButton.addEventListener("click", () => {
        void this.openRetrievedChunk(chunk);
      });
      header.createSpan({
        cls: "ixplorer-index-search__score",
        text: chunk.score.toFixed(3),
      });
      item.createDiv({
        cls: "ixplorer-index-search__snippet",
        text: chunk.text,
      });
    }
  }

  private renderFollowUps(followUps: string[]): void {
    if (!this.followUpsEl) {
      return;
    }

    this.followUpsEl.empty();

    if (followUps.length === 0) {
      return;
    }

    this.followUpsEl.createEl("h3", { text: "Follow-ups" });
    const list = this.followUpsEl.createDiv({ cls: "ixplorer-chat__followup-list" });

    for (const question of followUps) {
      const button = list.createEl("button", {
        cls: "ixplorer-chat__followup",
        text: question,
        attr: { type: "button" },
      });
      button.addEventListener("click", () => {
        if (this.textareaEl) {
          this.textareaEl.value = question;
          this.textareaEl.focus();
        }
      });
    }
  }

  private async toggleHistoryPopover(anchorEl: HTMLElement): Promise<void> {
    if (this.historyPopoverEl) {
      this.closeHistoryPopover();
      return;
    }

    await this.refreshSavedChatSummaries();
    const popover = this.contentEl.createDiv({ cls: "ixplorer-chat__history-popover" });
    this.historyPopoverEl = popover;
    this.historyPopoverAnchorEl = anchorEl;
    this.renderHistoryPopoverContent(popover);
    this.positionHistoryPopover(anchorEl, popover);
    document.addEventListener("pointerdown", this.handleDocumentPointerDown, true);
  }

  private renderHistoryPopoverContent(containerEl: HTMLElement): void {
    containerEl.empty();

    const searchRow = containerEl.createDiv({ cls: "ixplorer-chat__history-search" });
    setIcon(searchRow.createSpan({ cls: "ixplorer-chat__history-search-icon" }), "search");
    const searchInput = searchRow.createEl("input", {
      attr: {
        type: "search",
        placeholder: "Search saved chats",
        "aria-label": "Search saved chats",
      },
    });
    searchInput.value = this.historySearchQuery;
    searchInput.addEventListener("input", () => {
      this.historySearchQuery = searchInput.value;
      this.renderHistoryPopoverContent(containerEl);
    });

    const header = containerEl.createDiv({ cls: "ixplorer-chat__history-header" });
    header.createSpan({ text: "Recent chats" });
    header.createSpan({ text: String(this.savedChatSummaries.length) });

    const list = containerEl.createDiv({ cls: "ixplorer-chat__history-list" });
    const filtered = this.filterSavedChatSummaries(this.historySearchQuery);

    if (filtered.length === 0) {
      list.createDiv({
        cls: "ixplorer-chat__history-empty",
        text: this.savedChatSummaries.length === 0 ? "No saved chats yet." : "No matching chats.",
      });
      return;
    }

    for (const chat of filtered) {
      const item = this.renderSavedChatRow(list, chat, "ixplorer-chat__history-item");
      if (chat.id === this.currentChatId) {
        item.addClass("is-active");
      }
    }

    if (this.historySearchQuery) {
      window.setTimeout(() => {
        searchInput.focus();
        searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
      }, 0);
    }
  }

  private filterSavedChatSummaries(query: string): SavedChatSummary[] {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return this.savedChatSummaries;
    }

    return this.savedChatSummaries.filter((chat) =>
      chat.title.toLowerCase().includes(normalizedQuery),
    );
  }

  private positionHistoryPopover(anchorEl: HTMLElement, popoverEl: HTMLElement): void {
    const anchorRect = anchorEl.getBoundingClientRect();
    const hostRect = this.contentEl.getBoundingClientRect();
    const popoverRect = popoverEl.getBoundingClientRect();
    const gap = 8;
    const left = Math.min(
      Math.max(anchorRect.right - hostRect.left - popoverRect.width, gap),
      Math.max(gap, hostRect.width - popoverRect.width - gap),
    );
    const top = anchorRect.bottom - hostRect.top + gap;

    popoverEl.style.left = `${left}px`;
    popoverEl.style.top = `${top}px`;
  }

  private closeHistoryPopover(): void {
    document.removeEventListener("pointerdown", this.handleDocumentPointerDown, true);
    this.historyPopoverEl?.remove();
    this.historyPopoverEl = null;
    this.historyPopoverAnchorEl = null;
  }

  private closeHistoryPopoverOnOutsidePointer(event: PointerEvent): void {
    if (!this.historyPopoverEl) {
      return;
    }

    const target = event.target;
    if (!(target instanceof Node)) {
      return;
    }

    if (this.historyPopoverEl.contains(target) || this.historyPopoverAnchorEl?.contains(target)) {
      return;
    }

    this.closeHistoryPopover();
  }

  private async loadSavedChat(id: string): Promise<void> {
    await this.saveCurrentChat();
    const chat = await this.services.loadSavedChat(id);

    if (!chat) {
      new Notice("Saved chat was not found.");
      await this.refreshSavedChatSummaries();
      this.render();
      return;
    }

    this.currentChatId = chat.id;
    this.currentChatCreatedAt = chat.createdAt;
    this.messages = chat.messages;
    this.lastAnswer = chat.lastAnswer;
    this.attachedContextPaths = [...chat.attachedContextPaths];
    this.currentChatSettings = this.resolveChatSettings(chat.chatSettings);
    this.editingMessageIndex = null;
    this.closeHistoryPopover();
    await this.refreshSavedChatSummaries();
    this.render();
  }

  private async saveCurrentChat(): Promise<void> {
    if (this.messages.length === 0) {
      return;
    }

    const saved = await this.services.saveChat({
      id: this.currentChatId ?? undefined,
      createdAt: this.currentChatCreatedAt ?? undefined,
      title: inferChatTitle(this.messages),
      messages: this.messages,
      lastAnswer: this.lastAnswer,
      attachedContextPaths: this.attachedContextPaths,
      chatSettings: this.currentChatSettings,
    });
    this.currentChatId = saved.id;
    this.currentChatCreatedAt = saved.createdAt;
    await this.refreshSavedChatSummaries();
  }

  private async refreshSavedChatSummaries(): Promise<void> {
    this.savedChatSummaries = await this.services.listSavedChats();
  }

  private async updateChatModel(model: string): Promise<void> {
    const normalizedModel = model.trim();
    this.currentChatSettings = {
      ...this.currentChatSettings,
      model: normalizedModel || this.createDefaultChatSettings().model,
    };
    if (this.modelInputEl && this.modelInputEl.value !== this.currentChatSettings.model) {
      this.modelInputEl.value = this.currentChatSettings.model;
    }
    await this.services.setChatModel(this.currentChatSettings.model);
    await this.saveCurrentChat();
  }

  private async updateSearchMode(searchMode: ResearchSearchMode): Promise<void> {
    this.currentChatSettings = { ...this.currentChatSettings, searchMode };
    await this.saveCurrentChat();
  }

  private async updateDeepResearch(deepResearch: boolean): Promise<void> {
    this.currentChatSettings = { ...this.currentChatSettings, deepResearch };
    await this.saveCurrentChat();
  }

  private createDefaultChatSettings(): SavedChatSettings {
    return {
      model: this.services.getChatModel(),
      searchMode: "indexOnly",
      deepResearch: false,
    };
  }

  private resolveChatSettings(settings: SavedChatSettings | undefined): SavedChatSettings {
    const defaults = this.createDefaultChatSettings();

    return {
      model: settings?.model.trim() || defaults.model,
      searchMode: settings?.searchMode ?? defaults.searchMode,
      deepResearch: settings?.deepResearch ?? defaults.deepResearch,
    };
  }

  private async submitQuestion(): Promise<void> {
    const question = this.textareaEl?.value.trim() ?? "";

    if (!question || this.isRunning || this.getSearchUnavailableMessage() !== null) {
      return;
    }

    if (this.textareaEl) {
      this.textareaEl.value = "";
    }
    await this.runQuestion(question, { appendQuestion: true });
  }

  private async submitEditedQuestion(index: number, value: string): Promise<void> {
    const question = value.trim();

    if (!question || this.isRunning || this.getSearchUnavailableMessage() !== null) {
      return;
    }

    const hasAnswer = this.messages[index + 1]?.role === "assistant";
    this.editingMessageIndex = null;

    if (hasAnswer) {
      await this.runQuestion(question, { appendQuestion: true });
      return;
    }

    this.messages = this.messages.map((message, messageIndex) =>
      messageIndex === index ? { ...message, content: question } : message,
    );
    await this.saveCurrentChat();
    await this.runQuestion(question, { appendQuestion: false });
  }

  private async runQuestion(
    question: string,
    options: {
      appendQuestion: boolean;
    },
  ): Promise<void> {
    this.isRunning = true;
    this.shouldStopRunning = false;
    await this.updateChatModel(this.modelInputEl?.value ?? this.currentChatSettings.model);
    this.setFormRunning(true);
    if (options.appendQuestion) {
      this.messages = [
        ...this.messages,
        { role: "user", content: question, createdAt: new Date().toISOString() },
      ];
      await this.saveCurrentChat();
    }
    this.lastAnswer = null;
    this.renderMessages();
    this.renderAnswerDetails();
    this.setProgressStatus(null);

    try {
      const service = this.services.createResearchService();

      for await (const event of service.answer({
        question,
        searchMode: this.getSearchMode(),
        deepResearch: this.isDeepResearchEnabled(),
        contextPaths: this.attachedContextPaths.length > 0 ? this.attachedContextPaths : undefined,
      })) {
        if (this.shouldStopRunning) {
          break;
        }
        this.applyResearchEvent(event);
      }
    } catch (error) {
      this.messages = nextAssistantMessage(this.messages, toUserMessage(error));
      await this.saveCurrentChat();
      new Notice(toUserMessage(error));
      this.renderMessages();
    } finally {
      this.isRunning = false;
      this.shouldStopRunning = false;
      this.setProgressStatus(null);
      this.setFormRunning(false);
      this.renderIndexControl();
    }
  }

  private stopRunningQuestion(): void {
    if (!this.isRunning) {
      return;
    }

    this.shouldStopRunning = true;
    if (this.submitButtonEl) {
      this.submitButtonEl.disabled = true;
      this.submitButtonEl.setText("Stopping");
    }
  }

  private async submitIndexSearch(): Promise<void> {
    const query = this.indexSearchQueryEl?.value.trim() ?? "";

    if (!query || this.isSearchingIndex) {
      return;
    }

    this.isSearchingIndex = true;
    this.indexSearchError = null;
    this.indexSearchResults = [];
    this.setIndexSearchDisabled(true);
    this.renderIndexSearchResults();

    try {
      this.indexSearchResults = await this.services.searchIndex({
        profileId:
          this.indexSearchProfileEl?.value ?? this.services.getIndexProfiles()[0]?.id ?? "",
        query,
        limit: readPositiveInteger(this.indexSearchTopKEl?.value, 5),
        minScore: readOptionalNumber(this.indexSearchMinScoreEl?.value),
        extension: normalizeExtensionFilter(this.indexSearchExtEl?.value ?? ""),
      });
    } catch (error) {
      this.indexSearchError = toUserMessage(error);
      new Notice(toUserMessage(error));
    } finally {
      this.isSearchingIndex = false;
      this.setIndexSearchDisabled(false);
      this.renderIndexSearchResults();
    }
  }

  private setIndexSearchDisabled(disabled: boolean): void {
    for (const element of [
      this.indexSearchProfileEl,
      this.indexSearchQueryEl,
      this.indexSearchTopKEl,
      this.indexSearchMinScoreEl,
      this.indexSearchExtEl,
      this.indexSearchButtonEl,
    ]) {
      if (element) {
        element.disabled = disabled;
      }
    }
  }

  private applyResearchEvent(event: ResearchStreamEvent): void {
    if (event.type === "status") {
      this.setProgressStatus(event.message);
      return;
    }

    if (event.type === "delta") {
      this.messages = nextAssistantMessage(this.messages, event.content);
      this.renderMessages();
      return;
    }

    this.lastAnswer = event.answer;
    this.messages = attachEvidenceToLastAssistantMessage(
      this.messages,
      event.answer.evidence ?? [],
    );
    this.renderAnswerDetails();
    this.renderMessages();
    void this.saveCurrentChat();
  }

  private setProgressStatus(message: string | null): void {
    if (!this.progressStatusEl) {
      return;
    }

    this.progressStatusEl.setText(message ?? "");
  }

  private setFormRunning(running: boolean): void {
    if (this.submitButtonEl) {
      this.submitButtonEl.disabled = false;
      this.submitButtonEl.setText(running ? "Stop" : "Ask");
    }

    if (this.textareaEl) {
      this.textareaEl.disabled = running;
    }

    if (this.modelInputEl) {
      this.modelInputEl.disabled = running;
    }

    if (this.searchModeEl) {
      this.searchModeEl.disabled = running;
    }

    if (this.deepResearchEl) {
      this.deepResearchEl.disabled = running || this.getSearchMode() === "indexOnly";
    }

    this.updateSubmitAvailability();
  }

  private getSearchMode(): ResearchSearchMode {
    const value = this.searchModeEl?.value;

    return isResearchSearchMode(value) ? value : "indexOnly";
  }

  private isDeepResearchEnabled(): boolean {
    return this.getSearchMode() !== "indexOnly" && this.deepResearchEl?.checked === true;
  }

  private updateDeepResearchAvailability(): void {
    if (!this.deepResearchEl) {
      return;
    }

    this.deepResearchEl.disabled = this.isRunning || this.getSearchMode() === "indexOnly";
  }

  private updateSubmitAvailability(): void {
    if (!this.submitButtonEl) {
      return;
    }

    if (this.isRunning) {
      this.submitButtonEl.disabled = false;
      this.submitButtonEl.setAttr("title", "Stop the current answer");
      this.submitButtonEl.setAttr("aria-label", "Stop the current answer");
      this.submitButtonTooltipEl?.setAttr("title", "Stop the current answer");
      return;
    }

    const unavailableMessage = this.getSearchUnavailableMessage();

    if (unavailableMessage !== null) {
      this.submitButtonEl.disabled = true;
      this.submitButtonEl.setAttr("title", unavailableMessage);
      this.submitButtonEl.setAttr("aria-label", `Ask unavailable: ${unavailableMessage}`);
      this.submitButtonTooltipEl?.setAttr("title", unavailableMessage);
      return;
    }

    this.submitButtonEl.disabled = false;
    this.submitButtonEl.setAttr("title", "Ask");
    this.submitButtonEl.setAttr("aria-label", "Ask");
    this.submitButtonTooltipEl?.setAttr("title", "Ask");
  }

  private getSearchUnavailableMessage(): string | null {
    return this.getSearchMode() !== "indexOnly" && !this.services.isWebSearchEnabled()
      ? "Enable web search in Ixplorer settings to use this search mode."
      : null;
  }

  private async openCitation(citation: Citation): Promise<void> {
    const target = citationTarget(citation);

    if (target.kind === "web") {
      window.open(target.target, "_blank", "noopener");
      return;
    }

    await this.app.workspace.openLinkText(target.target, "", false);
  }

  private async openRetrievedChunk(chunk: RetrievedChunk): Promise<void> {
    await this.openCitation({
      ...formatCitationForChunk(chunk),
      id: chunk.id,
    });
  }

  private async saveAnswerToNewNote(): Promise<void> {
    if (!this.lastAnswer) {
      return;
    }

    const path = await this.nextAvailableNotePath(researchAnswerNotePath(this.lastAnswer));
    await this.ensureFolder(path);
    await this.app.vault.create(path, formatResearchAnswerNote(this.lastAnswer));
    new Notice("Saved Ixplorer answer to a new note.");
    await this.app.workspace.openLinkText(path, "", false);
  }

  private async appendAnswerToActiveNote(): Promise<void> {
    if (!this.lastAnswer) {
      return;
    }

    const activeFile = this.app.workspace.getActiveFile();

    if (!activeFile) {
      new Notice("Open a note before appending an Ixplorer answer.");
      return;
    }

    await this.app.vault.append(activeFile, formatResearchAnswerAppendBlock(this.lastAnswer));
    new Notice("Appended Ixplorer answer to the active note.");
  }

  private async ensureFolder(path: string): Promise<void> {
    const folder = path.split("/").slice(0, -1).join("/");

    if (!folder || this.app.vault.getFolderByPath(folder)) {
      return;
    }

    await this.app.vault.createFolder(folder);
  }

  private async nextAvailableNotePath(path: string): Promise<string> {
    if (!this.app.vault.getAbstractFileByPath(path)) {
      return path;
    }

    const extensionIndex = path.lastIndexOf(".");
    const base = extensionIndex === -1 ? path : path.slice(0, extensionIndex);
    const extension = extensionIndex === -1 ? "" : path.slice(extensionIndex);

    for (let index = 2; index < 1000; index += 1) {
      const candidate = `${base}-${index}${extension}`;

      if (!this.app.vault.getAbstractFileByPath(candidate)) {
        return candidate;
      }
    }

    return `${base}-${Date.now()}${extension}`;
  }
}

function createLabeledInput(
  containerEl: HTMLElement,
  options: {
    label: string;
    value: string;
    type: string;
    min?: string;
    max?: string;
    step?: string;
    placeholder?: string;
  },
): HTMLInputElement {
  const label = containerEl.createEl("label", { cls: "ixplorer-index-search__filter" });
  label.createSpan({ text: options.label });
  const attr: Record<string, string> = {
    type: options.type,
    value: options.value,
  };

  for (const key of ["min", "max", "step", "placeholder"] as const) {
    if (options[key] !== undefined) {
      attr[key] = options[key];
    }
  }

  const input = label.createEl("input", {
    attr,
  });

  return input;
}

function createSearchModeOptions(selectEl: HTMLSelectElement): void {
  const options: Array<{ value: ResearchSearchMode; label: string }> = [
    { value: "indexOnly", label: "Index only" },
    { value: "indexAndWeb", label: "Index + Web" },
    { value: "webOnly", label: "Web only" },
  ];

  for (const option of options) {
    selectEl.createEl("option", {
      text: option.label,
      value: option.value,
    });
  }
}

function isResearchSearchMode(value: string | undefined): value is ResearchSearchMode {
  return value === "indexOnly" || value === "indexAndWeb" || value === "webOnly";
}

function attachEvidenceToLastAssistantMessage(
  messages: ChatDisplayMessage[],
  evidence: RetrievedChunk[],
): ChatDisplayMessage[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role !== "assistant") {
      continue;
    }

    return [
      ...messages.slice(0, index),
      { ...messages[index], evidence },
      ...messages.slice(index + 1),
    ];
  }

  return messages;
}

function buildCitationRefs(evidence: RetrievedChunk[]): ChatCitationRef[] {
  const byKey = new Map<string, ChatCitationRef>();

  for (const chunk of evidence) {
    const key = sourceCitationKey(chunk);
    const existing = byKey.get(key);

    if (existing) {
      existing.chunkIds.add(chunk.id);
      continue;
    }

    byKey.set(key, {
      number: byKey.size + 1,
      chunk,
      chunkIds: new Set([chunk.id]),
      key,
    });
  }

  return Array.from(byKey.values());
}

function sourceCitationKey(chunk: RetrievedChunk): string {
  switch (chunk.source.kind) {
    case "markdown":
      return [
        "markdown",
        chunk.source.path,
        chunk.source.blockId ?? "",
        chunk.source.headingPath.join("/"),
      ].join(":");
    case "pdf":
      return ["pdf", chunk.source.path, chunk.source.pageNumber].join(":");
    case "document":
      return ["document", chunk.source.path, chunk.source.format].join(":");
    case "web":
      return ["web", chunk.source.url].join(":");
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

function stripRenderedCitationIds(value: string): string {
  return value.replace(/\s*\[[^\]\n]{8,}\]/g, "");
}

function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value.replace(/["\\]/g, "\\$&");
}

async function copyToClipboard(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
  new Notice("Copied to clipboard.");
}

function formatMessageTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatMessageCount(count: number): string {
  return `${count} ${count === 1 ? "message" : "messages"}`;
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readOptionalNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }

  const parsed = Number.parseFloat(value.replace(",", "."));

  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeExtensionFilter(value: string): string | undefined {
  const normalized = value.trim().replace(/^\./, "").toLowerCase();

  return normalized || undefined;
}

function formatIndexSearchCitation(chunk: RetrievedChunk): string {
  const citation = formatCitationForChunk(chunk);

  return citation.label;
}

function formatCitationForChunk(chunk: RetrievedChunk): Citation {
  switch (chunk.source.kind) {
    case "markdown":
      return {
        id: chunk.id,
        label: chunk.source.headingPath.length
          ? `${chunk.source.path} > ${chunk.source.headingPath.join(" > ")}`
          : chunk.source.path,
        source: chunk.source,
      };
    case "pdf":
      return {
        id: chunk.id,
        label: `${chunk.source.path} p. ${chunk.source.pageNumber}`,
        source: chunk.source,
      };
    case "document":
      return {
        id: chunk.id,
        label: chunk.source.path,
        source: chunk.source,
      };
    case "web":
      return {
        id: chunk.id,
        label: chunk.source.url,
        source: chunk.source,
      };
  }
}

function isContextDocumentPath(path: string): boolean {
  return /\.(md|pdf|txt|docx|epub|fb2)$/i.test(path);
}

class ContextDocumentPickerModal extends Modal {
  private selectedPaths: Set<string>;
  private listEl: HTMLElement | null = null;
  private query = "";

  constructor(
    app: ConstructorParameters<typeof Modal>[0],
    private readonly options: {
      files: TFile[];
      selectedPaths: string[];
      onSubmit: (paths: string[]) => void;
    },
  ) {
    super(app);
    this.selectedPaths = new Set(options.selectedPaths);
  }

  onOpen(): void {
    this.titleEl.setText("Attach context documents");
    this.contentEl.empty();
    this.contentEl.addClass("ixplorer-context-picker");

    const search = this.contentEl.createEl("input", {
      cls: "ixplorer-context-picker__search",
      attr: {
        type: "search",
        placeholder: "Filter documents",
        "aria-label": "Filter documents",
      },
    });
    search.addEventListener("input", () => {
      this.query = search.value.trim().toLowerCase();
      this.renderList();
    });

    this.listEl = this.contentEl.createDiv({ cls: "ixplorer-context-picker__list" });
    this.renderList();

    const actions = this.contentEl.createDiv({ cls: "ixplorer-context-picker__actions" });
    const cancel = actions.createEl("button", { text: "Cancel", attr: { type: "button" } });
    cancel.addEventListener("click", () => this.close());
    const apply = actions.createEl("button", {
      cls: "mod-cta",
      text: "Attach",
      attr: { type: "button" },
    });
    apply.addEventListener("click", () => {
      this.options.onSubmit(Array.from(this.selectedPaths).sort());
      this.close();
    });
  }

  private renderList(): void {
    if (!this.listEl) {
      return;
    }

    this.listEl.empty();
    const files = this.options.files.filter((file) => file.path.toLowerCase().includes(this.query));

    for (const file of files.slice(0, 250)) {
      const label = this.listEl.createEl("label", { cls: "ixplorer-context-picker__item" });
      const checkbox = label.createEl("input", { attr: { type: "checkbox" } });
      checkbox.checked = this.selectedPaths.has(file.path);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          this.selectedPaths.add(file.path);
        } else {
          this.selectedPaths.delete(file.path);
        }
      });
      label.createSpan({ text: file.path });
    }
  }
}

function formatRelativeTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);

  if (minutes < 1) {
    return "now";
  }

  if (hours < 1) {
    return `${minutes}m`;
  }

  if (days < 1) {
    return `${hours}h`;
  }

  if (weeks < 1) {
    return `${days}d`;
  }

  return `${weeks}w`;
}
