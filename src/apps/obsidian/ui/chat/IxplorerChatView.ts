import { ItemView, Notice, WorkspaceLeaf, setIcon } from "obsidian";

import {
  SaveChatInput,
  SavedChat,
  SavedChatSettings,
  SavedChatSummary,
  inferChatTitle,
} from "@core/chat/savedChat";
import { chatHistoryForPrompt } from "@application/use-cases/chat";
import { IndexingState } from "@adapters/indexing";
import { estimateResearchRequestTokens } from "@core/research";
import type { ResearchMode } from "@core/research";
import { ResearchService } from "@application/use-cases/research";
import type { ResearchSearchMode } from "@application/use-cases/research";
import { ResearchAnswer } from "@core/answer";
import { Citation } from "@core/model";
import { RetrievedChunk } from "@core/model";
import { AnswerNoteWriter } from "./research/AnswerNoteWriter";
import { ToolOutputViewer } from "./toolOutputViewer";
import { describeToolCall } from "./toolCallView";
import type { ChainItem } from "@core/conversation";
import {
  ChatComposerRefs,
  ComposerControls,
  IndexProfileSelectOption,
  renderAttachedContext as renderComposerAttachedContext,
  renderChatComposer,
} from "./ChatComposer";
import { IxplorerPanel, renderChatWindowActions, renderPanelTabs } from "./ChatHeader";
import {
  patchActiveAssistantMessage,
  renderChatTranscript,
  renderFollowUps as renderChatFollowUps,
} from "./ChatTranscript";
import type { ChatTranscriptOptions } from "./ChatTranscript";
import { CitationPopoverController } from "./citations/CitationPopover";
import { ChatModelSelectOption } from "./ChatComposer";
import { formatCitationForChunk } from "./citations/citationFormatting";
import { DiagnosticReportModalController } from "@apps/obsidian/ui/DiagnosticReportModal";
import {
  ContextDocumentPickerModal,
  isContextDocumentPath,
} from "./context/ContextDocumentPickerModal";
import { expandAttachedContextPaths } from "./context/attachmentPaths";
import { IndexControlActions } from "@apps/obsidian/ui/index/IndexControl";
import {
  IndexSearchController,
  IndexSearchOptions,
} from "@apps/obsidian/ui/index/IndexSearchController";
import { ResearchQuestionController } from "./research/ResearchQuestionController";
import {
  chatModelProfileLabel,
  createDefaultChatSettings,
  resolveChatSettings,
  stripContextDiagnostics,
} from "./chatViewHelpers";
import { ChatDisplayMessage } from "@core/conversation";
import { stripMessageDiagnostics } from "@core/conversation";
import { citationTarget } from "./conversationFormatting";
import {
  positionSavedChatsPopover,
  renderSavedChatsEmptyState,
  renderSavedChatsPopoverContent,
} from "./history/SavedChatsPanel";

export const IXPLORER_CHAT_VIEW_TYPE = "ixplorer-chat";

export type { IndexSearchOptions };

export interface IxplorerChatViewServices {
  createResearchService(chatModelProfileId?: string, indexProfileId?: string): ResearchService;
  getIndexingState?(indexProfileId?: string): IndexingState | undefined;
  subscribeToIndexingState?(
    indexProfileId: string | undefined,
    listener: (state: IndexingState) => void,
  ): () => void;
  indexingActions?: IndexControlActions;
  isWebSearchEnabled(): boolean;
  getChatModel(): string;
  getAvailableChatModels(): string[];
  getChatModelProfiles(): ChatModelSelectOption[];
  getDefaultChatModelProfileId(): string;
  getDefaultIndexProfileId(): string;
  getIndexProfiles(): IndexProfileSelectOption[];
  searchIndex(options: IndexSearchOptions): Promise<RetrievedChunk[]>;
  listSavedChats(): Promise<SavedChatSummary[]>;
  loadSavedChat(id: string): Promise<SavedChat | null>;
  saveChat(input: SaveChatInput): Promise<SavedChat>;
  renameSavedChat(id: string, title: string): Promise<void>;
  deleteSavedChat(id: string): Promise<void>;
  isChatIndexControlShown(): boolean;
  isDebugMode(): boolean;
  shouldIncludeActiveFileContext(): boolean;
  setChatIndexControlShown(shown: boolean): Promise<void>;
}

export class IxplorerChatView extends ItemView {
  private readonly services: IxplorerChatViewServices;
  private readonly citationPopover: CitationPopoverController;
  private readonly diagnosticModal: DiagnosticReportModalController;
  private readonly answerNoteWriter: AnswerNoteWriter;
  private readonly toolOutputViewer: ToolOutputViewer;
  private readonly researchController: ResearchQuestionController;
  private readonly indexSearch: IndexSearchController;
  private messages: ChatDisplayMessage[] = [];
  private lastAnswer: ResearchAnswer | null = null;
  private attachedContextPaths: string[] = [];
  private currentChatSettings: SavedChatSettings;
  private currentResearchMode: ResearchMode = "instant";
  private currentChatId: string | null = null;
  private currentChatCreatedAt: string | null = null;
  private savedChatSummaries: SavedChatSummary[] = [];
  private historySearchQuery = "";
  private activePanel: IxplorerPanel = "chat";
  private isRunning = false;
  private editingMessageIndex: number | null = null;

  private transcriptEl: HTMLElement | null = null;
  private followUpsEl: HTMLElement | null = null;
  private textareaEl: HTMLTextAreaElement | null = null;
  private progressStatusEl: HTMLElement | null = null;
  private contextIndicatorEl: HTMLElement | null = null;
  private submitButtonEl: HTMLButtonElement | null = null;
  private submitButtonTooltipEl: HTMLElement | null = null;
  private attachedContextEl: HTMLElement | null = null;
  private composerControls: ComposerControls | null = null;
  private composerRefs: ChatComposerRefs | null = null;
  private historyPopoverEl: HTMLElement | null = null;
  private historyPopoverAnchorEl: HTMLElement | null = null;
  private activeMessageRenderFrame: number | null = null;
  private readonly handleDocumentPointerDown = (event: PointerEvent): void => {
    this.closeHistoryPopoverOnOutsidePointer(event);
  };
  private unsubscribeIndexing: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, services: IxplorerChatViewServices) {
    super(leaf);
    this.services = services;
    this.citationPopover = new CitationPopoverController({
      hostEl: this.contentEl,
      onOpenChunk: (chunk) => void this.openRetrievedChunk(chunk),
    });
    this.diagnosticModal = new DiagnosticReportModalController(this.app);
    this.answerNoteWriter = new AnswerNoteWriter(this.app);
    this.toolOutputViewer = new ToolOutputViewer(this.app);
    this.researchController = new ResearchQuestionController({
      getQuestionInput: () => this.textareaEl?.value ?? "",
      clearQuestionInput: () => {
        if (this.textareaEl) {
          this.textareaEl.value = "";
          this.textareaEl.dispatchEvent(new Event("input"));
        }
      },
      getMessages: () => this.messages,
      setMessages: (messages) => {
        this.messages = messages;
      },
      getLastAnswer: () => this.lastAnswer,
      setLastAnswer: (answer) => {
        this.lastAnswer = answer;
      },
      getModelInputValue: () => this.composerControls?.getModel() ?? "",
      getCurrentModel: () => this.currentChatSettings.chatModelProfileId,
      getCurrentModelLabel: () => this.getCurrentChatModelLabel(),
      getContextLimitTokens: () => this.getContextLimitTokens(),
      getReservedOutputTokens: () => this.getReservedOutputTokens(),
      updateChatModel: (model) => this.updateChatModel(model),
      saveCurrentChat: () => this.saveCurrentChat(),
      createResearchService: () =>
        this.services.createResearchService(
          this.currentChatSettings.chatModelProfileId,
          this.currentChatSettings.indexProfileId,
        ),
      getSearchMode: () => this.getSearchMode(),
      getResearchMode: () => this.currentResearchMode,
      getContextMode: () => this.currentChatSettings.contextMode ?? "include",
      getActiveFilePath: () => this.app.workspace.getActiveFile()?.path,
      shouldIncludeActiveFileContext: () => this.services.shouldIncludeActiveFileContext(),
      shouldIncludeContextDiagnostics: () => this.services.isDebugMode(),
      // Folder attachments ("path/") expand into their current files only here,
      // at request time — the composer keeps showing one folder chip.
      getContextPaths: () =>
        expandAttachedContextPaths(
          this.attachedContextPaths,
          this.app.vault.getFiles().map((file) => file.path),
        ),
      clearContextPaths: () => {
        this.attachedContextPaths = [];
        this.renderAttachedContext();
      },
      getSearchUnavailableMessage: () => this.getSearchUnavailableMessage(),
      setEditingMessageIndex: (index) => {
        this.editingMessageIndex = index;
      },
      setProgressStatus: (message) => this.setProgressStatus(message),
      setFormRunning: (running) => this.setFormRunning(running),
      setRunningState: (running) => {
        this.isRunning = running;
      },
      renderMessages: () => this.renderMessages(),
      renderActiveMessage: () => this.scheduleActiveMessageRender(),
      renderAnswerDetails: () => this.renderAnswerDetails(),
      renderIndexControl: () => this.indexSearch.renderIndexControl(),
    });
    this.indexSearch = new IndexSearchController({
      getIndexProfiles: () => this.services.getIndexProfiles(),
      getSelectedIndexProfileId: () => this.currentChatSettings.indexProfileId ?? "",
      getActivePanel: () => this.activePanel,
      getIndexingState: this.services.getIndexingState
        ? (indexProfileId) => this.services.getIndexingState?.(indexProfileId)
        : undefined,
      indexingActions: this.services.indexingActions,
      searchIndex: (options) => this.services.searchIndex(options),
      onOpenChunk: (chunk) => void this.openRetrievedChunk(chunk),
    });
    this.currentChatSettings = createDefaultChatSettings(this.services);
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
    if (this.activeMessageRenderFrame !== null) {
      window.cancelAnimationFrame(this.activeMessageRenderFrame);
      this.activeMessageRenderFrame = null;
    }
    this.unsubscribeIndexing?.();
    this.unsubscribeIndexing = null;
    document.removeEventListener("pointerdown", this.handleDocumentPointerDown, true);
    this.citationPopover.close();
    this.diagnosticModal.close();
    this.closeHistoryPopover();
    this.contentEl.empty();
  }

  private render(): void {
    this.diagnosticModal.close();
    this.contentEl.empty();
    this.contentEl.addClass("ixplorer-chat-view");

    const root = this.contentEl.createDiv({ cls: "ixplorer-chat" });
    const header = root.createDiv({ cls: "ixplorer-chat__header" });
    header.createEl("h2", { text: "Ixplorer" });
    renderPanelTabs(header, this.headerOptions());

    const chatPanel = root.createDiv({
      cls: `ixplorer-chat__panel${this.activePanel === "chat" ? "" : " is-hidden"}`,
    });
    const chatToolbar = chatPanel.createDiv({ cls: "ixplorer-chat__toolbar" });
    renderChatWindowActions(chatToolbar, this.headerOptions());

    this.transcriptEl = chatPanel.createDiv({
      cls: "ixplorer-chat__transcript",
      attr: { role: "log", "aria-live": "polite" },
    });

    const results = chatPanel.createDiv({ cls: "ixplorer-chat__results" });
    this.followUpsEl = results.createDiv({ cls: "ixplorer-chat__followups" });

    this.composerRefs = renderChatComposer(chatPanel, {
      settings: this.currentChatSettings,
      availableModels: this.services.getChatModelProfiles(),
      availableIndexes: this.services.getIndexProfiles(),
      contextFilePaths: this.app.vault
        .getFiles()
        .filter((file) => isContextDocumentPath(file.path))
        .map((file) => file.path)
        .sort(),
      researchMode: this.currentResearchMode,
      onSubmit: () => void this.researchController.submitQuestion(),
      onStop: () => {
        this.researchController.stopRunningQuestion();
        this.updateStoppingState();
      },
      onQuestionInput: () => this.updateSubmitAvailability(),
      onOpenContextPicker: () => this.openContextPicker(),
      onUpdateModel: (model) => void this.updateChatModel(model),
      onUpdateIndex: (indexProfileId) => void this.updateIndexProfile(indexProfileId),
      onUpdateContextMode: (contextMode) => void this.updateContextMode(contextMode),
      onUpdateSearchMode: (searchMode) => {
        void this.updateSearchMode(searchMode);
        this.updateSubmitAvailability();
      },
      onUpdateResearchMode: (mode) => {
        this.currentResearchMode = mode;
      },
    });
    this.progressStatusEl = this.composerRefs.progressStatusEl;
    this.contextIndicatorEl = this.composerRefs.contextIndicatorEl;
    this.textareaEl = this.composerRefs.textareaEl;
    this.submitButtonTooltipEl = this.composerRefs.submitButtonTooltipEl;
    this.submitButtonEl = this.composerRefs.submitButtonEl;
    this.attachedContextEl = this.composerRefs.attachedContextEl;
    this.composerControls = this.composerRefs.controls;
    this.renderAttachedContext();
    this.updateSubmitAvailability();

    const indexSearchRoot = root.createDiv({
      cls: `ixplorer-index-search${this.activePanel === "indexSearch" ? "" : " is-hidden"}`,
    });
    this.indexSearch.render(indexSearchRoot);

    this.unsubscribeIndexing?.();
    this.unsubscribeIndexing =
      this.services.subscribeToIndexingState?.(this.currentChatSettings.indexProfileId, () => {
        this.indexSearch.renderIndexControl();
      }) ?? null;
    this.indexSearch.renderIndexControl();
    this.renderMessages();
    this.renderAnswerDetails();
  }

  private headerOptions(): Parameters<typeof renderPanelTabs>[1] {
    return {
      activePanel: this.activePanel,
      onPanelChange: (panel) => {
        this.activePanel = panel;
        this.render();
      },
      onOpenHistory: (anchorEl) => {
        void this.toggleHistoryPopover(anchorEl);
      },
      onNewChat: () => {
        void this.startNewChat();
      },
    };
  }

  private async startNewChat(): Promise<void> {
    await this.saveCurrentChat();
    this.messages = [];
    this.lastAnswer = null;
    this.attachedContextPaths = [];
    this.currentChatSettings = createDefaultChatSettings(this.services);
    this.currentResearchMode = "instant";
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

    renderComposerAttachedContext(this.attachedContextEl, this.attachedContextPaths, (path) => {
      this.attachedContextPaths = this.attachedContextPaths.filter(
        (candidate) => candidate !== path,
      );
      this.renderAttachedContext();
      void this.saveCurrentChat();
    });
    this.composerControls?.setAttachmentsPresent(this.attachedContextPaths.length > 0);
  }

  private renderMessages(): void {
    if (!this.transcriptEl) {
      return;
    }

    renderChatTranscript(this.transcriptEl, this.transcriptOptions());
  }

  private scheduleActiveMessageRender(): void {
    if (this.activeMessageRenderFrame !== null) return;
    this.activeMessageRenderFrame = window.requestAnimationFrame(() => {
      this.activeMessageRenderFrame = null;
      if (
        !this.transcriptEl ||
        !patchActiveAssistantMessage(this.transcriptEl, this.transcriptOptions())
      ) {
        this.renderMessages();
      }
    });
  }

  private transcriptOptions(): ChatTranscriptOptions {
    return {
      app: this.app,
      markdownContext: this,
      messages: this.messages,
      editingMessageIndex: this.editingMessageIndex,
      assistantLabel: this.getCurrentChatModelLabel() || "Assistant",
      isDebugMode: this.services.isDebugMode(),
      renderEmptyState: (containerEl) => this.renderEmptyChatState(containerEl),
      onEditQuestion: (index) => {
        this.editingMessageIndex = index >= 0 ? index : null;
        this.renderMessages();
      },
      onSubmitEditedQuestion: (index, value) =>
        void this.researchController.submitEditedQuestion(index, value),
      onOpenCitationPopover: (anchorEl, ref) => this.citationPopover.open(anchorEl, ref),
      onScheduleCitationPopoverClose: (key) => this.citationPopover.scheduleClose(key),
      onScrollCitationBlockIntoView: (key) => this.citationPopover.scrollBlockIntoView(key),
      onOpenChunk: (chunk) => void this.openRetrievedChunk(chunk),
      onOpenToolOutput: (item) => void this.openToolOutput(item),
      onHighlightCitation: (key, highlighted) =>
        this.citationPopover.setHighlight(key, highlighted),
      onOpenDiagnosticReport: (diagnostics) => this.diagnosticModal.open(diagnostics),
      onSaveAnswerToNewNote: (answer) => void this.saveAnswerToNewNote(answer),
      onAppendAnswerToActiveNote: (answer) => void this.appendAnswerToActiveNote(answer),
    };
  }

  private renderAnswerDetails(): void {
    this.renderFollowUps(this.lastAnswer?.followUpQuestions ?? []);
  }

  private renderEmptyChatState(containerEl: HTMLElement): void {
    renderSavedChatsEmptyState(containerEl, {
      savedChats: this.savedChatSummaries,
      onOpenChat: (id) => void this.loadSavedChat(id),
      onViewAll: (anchorEl) => void this.toggleHistoryPopover(anchorEl),
      onRenameChat: (id, title) => this.renameSavedChat(id, title),
      onDeleteChat: (id) => this.deleteSavedChat(id),
    });
  }

  private renderFollowUps(followUps: string[]): void {
    if (!this.followUpsEl) {
      return;
    }

    renderChatFollowUps(this.followUpsEl, followUps, (question) => {
      if (this.textareaEl) {
        this.textareaEl.value = question;
        this.textareaEl.dispatchEvent(new Event("input"));
        this.textareaEl.focus();
      }
    });
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
    positionSavedChatsPopover(this.contentEl, anchorEl, popover);
    document.addEventListener("pointerdown", this.handleDocumentPointerDown, true);
  }

  private renderHistoryPopoverContent(containerEl: HTMLElement): void {
    renderSavedChatsPopoverContent(containerEl, {
      savedChats: this.savedChatSummaries,
      currentChatId: this.currentChatId,
      searchQuery: this.historySearchQuery,
      onSearchQueryChange: (query) => {
        this.historySearchQuery = query;
      },
      onOpenChat: (id) => void this.loadSavedChat(id),
      onViewAll: (anchorEl) => void this.toggleHistoryPopover(anchorEl),
      onRenameChat: (id, title) => this.renameSavedChat(id, title),
      onDeleteChat: (id) => this.deleteSavedChat(id),
    });
  }

  private async renameSavedChat(id: string, title: string): Promise<void> {
    await this.services.renameSavedChat(id, title);
    await this.refreshSavedChatSummaries();
    if (this.historyPopoverEl) {
      this.renderHistoryPopoverContent(this.historyPopoverEl);
    } else {
      this.renderMessages();
    }
  }

  private async deleteSavedChat(id: string): Promise<void> {
    await this.services.deleteSavedChat(id);
    if (this.currentChatId === id) {
      this.currentChatId = null;
    }
    await this.refreshSavedChatSummaries();
    if (this.historyPopoverEl) {
      this.renderHistoryPopoverContent(this.historyPopoverEl);
    } else {
      this.render();
    }
    new Notice("Chat deleted.");
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
    this.currentChatSettings = resolveChatSettings(this.services, chat.chatSettings);
    this.currentResearchMode = "instant";
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
      messages: this.services.isDebugMode()
        ? this.messages
        : stripMessageDiagnostics(this.messages),
      lastAnswer: this.services.isDebugMode()
        ? this.lastAnswer
        : stripContextDiagnostics(this.lastAnswer),
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
    const normalizedModel =
      model.trim() || createDefaultChatSettings(this.services).chatModelProfileId;
    this.currentChatSettings = {
      ...this.currentChatSettings,
      chatModelProfileId: normalizedModel,
    };
    if (this.composerControls?.getModel() !== this.currentChatSettings.chatModelProfileId) {
      this.composerControls?.setModel(this.currentChatSettings.chatModelProfileId);
    }
    await this.saveCurrentChat();
    this.renderMessages();
    this.updateSubmitAvailability();
  }

  private async updateIndexProfile(indexProfileId: string): Promise<void> {
    const normalizedIndex =
      indexProfileId.trim() || (createDefaultChatSettings(this.services).indexProfileId ?? "");
    this.currentChatSettings = {
      ...this.currentChatSettings,
      indexProfileId: normalizedIndex,
    };
    if (this.composerControls?.getIndexProfileId() !== this.currentChatSettings.indexProfileId) {
      this.composerControls?.setIndexProfileId(this.currentChatSettings.indexProfileId ?? "");
    }
    await this.saveCurrentChat();
  }

  private async updateContextMode(contextMode: "include" | "filter"): Promise<void> {
    this.currentChatSettings = {
      ...this.currentChatSettings,
      contextMode,
    };
    await this.saveCurrentChat();
  }

  private async updateSearchMode(searchMode: ResearchSearchMode): Promise<void> {
    this.currentChatSettings = { ...this.currentChatSettings, searchMode };
    await this.saveCurrentChat();
  }

  private updateStoppingState(): void {
    if (!this.isRunning) {
      return;
    }

    if (this.submitButtonEl) {
      this.submitButtonEl.disabled = true;
      this.submitButtonEl.dataset.mode = "stop";
      this.submitButtonEl.empty();
      setIcon(this.submitButtonEl, "loader");
    }
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
      this.submitButtonEl.dataset.mode = running ? "stop" : "ask";
      this.submitButtonEl.empty();
      setIcon(this.submitButtonEl, running ? "square" : "arrow-up");
    }

    if (this.textareaEl) {
      this.textareaEl.disabled = running;
    }

    this.composerControls?.setDisabled(running);

    this.updateSubmitAvailability();
  }

  private getSearchMode(): ResearchSearchMode {
    return this.composerControls?.getSearchMode() ?? "indexOnly";
  }

  private updateSubmitAvailability(): void {
    if (!this.submitButtonEl) {
      return;
    }
    this.updateContextWindowIndicator();

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
    if (!this.currentChatSettings.chatModelProfileId) {
      return "Create and select a chat model profile in Ixplorer settings.";
    }

    if (
      this.getSearchMode() !== "webOnly" &&
      this.getSearchMode() !== "none" &&
      !this.currentChatSettings.indexProfileId
    ) {
      return "Create and select an active index in Ixplorer settings.";
    }

    return this.getSearchMode() !== "indexOnly" &&
      this.getSearchMode() !== "none" &&
      !this.services.isWebSearchEnabled()
      ? "Enable web search in Ixplorer settings to use this search mode."
      : null;
  }

  private updateContextWindowIndicator(): void {
    if (!this.contextIndicatorEl) {
      return;
    }

    const usage = this.getContextWindowUsage();
    if (!usage) {
      this.contextIndicatorEl.style.setProperty("--ixplorer-context-used", "0%");
      this.contextIndicatorEl.setAttr("title", "Unknown model context window size");
      this.contextIndicatorEl.setAttr("aria-label", "Unknown model context window size");
      return;
    }

    const usedPercent = Math.max(
      0,
      Math.min(100, Math.round((usage.estimatedTokens / usage.limitTokens) * 100)),
    );
    const leftPercent = Math.max(0, 100 - usedPercent);
    const isWarning = usedPercent >= 80;
    const title = [
      isWarning ? "Context window warning:" : "Context window:",
      `${usedPercent}% used (${leftPercent}% left)`,
      `Estimated ${usage.estimatedTokens} of ${usage.limitTokens} tokens`,
      ...(isWarning ? ["Long history may reduce retrieved evidence budget."] : []),
    ].join("\n");

    this.contextIndicatorEl.style.setProperty("--ixplorer-context-used", `${usedPercent}%`);
    this.contextIndicatorEl.toggleClass("is-warning", isWarning);
    this.contextIndicatorEl.setAttr("title", title);
    this.contextIndicatorEl.setAttr(
      "aria-label",
      `${isWarning ? "Context window warning" : "Context window"}: ${usedPercent}% used, ${leftPercent}% left`,
    );
  }

  private getContextWindowUsage(): { estimatedTokens: number; limitTokens: number } | null {
    const estimatedTokens = estimateResearchRequestTokens({
      question: this.textareaEl?.value.trim() ?? "",
      chatHistory: chatHistoryForPrompt(this.messages),
      evidence: [],
      maxEvidenceItems: 0,
      reservedOutputTokens: this.getReservedOutputTokens(),
    });
    const limitTokens = this.getContextLimitTokens();

    return limitTokens ? { estimatedTokens, limitTokens } : null;
  }

  private getContextLimitTokens(): number | undefined {
    return this.getCurrentChatModelProfile()?.contextLength;
  }

  private getReservedOutputTokens(): number | undefined {
    return this.getCurrentChatModelProfile()?.maxTokens;
  }

  private getCurrentChatModelProfile(): ChatModelSelectOption | undefined {
    return this.services
      .getChatModelProfiles()
      .find((profile) => profile.id === this.currentChatSettings.chatModelProfileId);
  }

  private getCurrentChatModelLabel(): string {
    return chatModelProfileLabel(
      this.services.getChatModelProfiles(),
      this.currentChatSettings.chatModelProfileId,
    );
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

  private async openToolOutput(item: Extract<ChainItem, { kind: "tool-call" }>): Promise<void> {
    const view = describeToolCall({
      name: item.name,
      label: item.label,
      status: item.status,
      args: item.args,
      resultJson: item.resultJson,
    });
    await this.toolOutputViewer.open({
      name: item.name,
      intent: view.intent,
      status: item.status,
      args: item.args,
      resultJson: item.resultJson,
    });
  }

  private async saveAnswerToNewNote(answer: ResearchAnswer): Promise<void> {
    await this.answerNoteWriter.saveAnswerToNewNote(answer);
  }

  private async appendAnswerToActiveNote(answer: ResearchAnswer): Promise<void> {
    await this.answerNoteWriter.appendAnswerToActiveNote(answer);
  }
}
