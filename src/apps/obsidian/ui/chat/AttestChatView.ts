import { ItemView, Notice, WorkspaceLeaf } from "obsidian";

import {
  SaveChatInput,
  SavedChat,
  SavedChatSettings,
  SavedChatSummary,
  inferChatTitle,
} from "@core/chat/savedChat";
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
import { IndexProfileSelectOption } from "./ChatComposer";
import { AttestPanel, renderChatWindowActions, renderPanelTabs } from "./ChatHeader";
import {
  disposeChatTranscript,
  patchActiveAssistantMessage,
  renderChatTranscript,
  renderFollowUps as renderChatFollowUps,
} from "./ChatTranscript";
import type { ChatTranscriptOptions } from "./ChatTranscript";
import { CitationPopoverController } from "./citations/CitationPopover";
import { ChatModelSelectOption } from "./ChatComposer";
import { formatCitationForChunk } from "./citations/citationFormatting";
import { DiagnosticReportModalController } from "@apps/obsidian/ui/diagnostics/modal";
import {
  ContextDocumentPickerModal,
  isContextDocumentPath,
} from "./context/ContextDocumentPickerModal";
import { expandAttachedContextPaths } from "./context/attachmentPaths";
import {
  IndexSearchController,
  IndexSearchOptions,
  IndexSearchResult,
} from "@apps/obsidian/ui/index/IndexSearchController";
import { ResearchQuestionController } from "./research/ResearchQuestionController";
import {
  chatModelProfileLabel,
  createDefaultChatSettings,
  resolveChatSettings,
  stripContextDiagnostics,
} from "./chatViewHelpers";
import type { DocumentImageResolver } from "@application/ports";
import type { Translate, UiTranslator } from "@adapters/i18n";
import { legacyIndexImageNotice, searchUnavailableMessage } from "./chatViewStatus";
import { contextWindowUsage } from "./contextWindowUsage";
import { ChatDisplayMessage } from "@core/conversation";
import { stripMessageDiagnostics } from "@core/conversation";
import { citationTarget } from "./conversationFormatting";
import { renderSavedChatsEmptyState } from "./history/SavedChatsPanel";
import { SavedChatSessionController } from "./history/SavedChatSessionController";
import { SavedChatsPopoverController } from "./history/SavedChatsPopoverController";
import { ChatComposerController } from "./ChatComposerController";

export const ATTEST_CHAT_VIEW_TYPE = "attest-chat";

export type { IndexSearchOptions, IndexSearchResult };

export interface AttestChatViewServices {
  createResearchService(chatModelProfileId?: string, indexProfileId?: string): ResearchService;
  isWebSearchEnabled(): boolean;
  getChatModel(): string;
  getAvailableChatModels(): string[];
  getChatModelProfiles(): ChatModelSelectOption[];
  getDefaultChatModelProfileId(): string;
  getDefaultIndexProfileId(): string;
  getDefaultSearchMode(): ResearchSearchMode;
  getDefaultResearchMode(): ResearchMode;
  getIndexProfiles(): IndexProfileSelectOption[];
  getIndexSearchEmbedderWarning(indexProfileId: string): string | undefined;

  openIndexSettings(): void;
  openExternalUrl?(url: string): void | Promise<void>;

  resolveDocumentImage?: DocumentImageResolver["resolve"];
  searchIndex(options: IndexSearchOptions): Promise<IndexSearchResult>;
  listSavedChats(): Promise<SavedChatSummary[]>;
  loadSavedChat(id: string): Promise<SavedChat | null>;
  saveChat(input: SaveChatInput): Promise<SavedChat>;
  renameSavedChat(id: string, title: string): Promise<void>;
  setSavedChatFavorite(id: string, isFavorite: boolean): Promise<void>;
  deleteSavedChat(id: string): Promise<void>;
  getTranslator(): UiTranslator;
  isDebugMode(): boolean;
  shouldIncludeActiveFileContext(): boolean;
}

export class AttestChatView extends ItemView {
  private readonly services: AttestChatViewServices;

  /** Late-bound lookup so a language change applies on the next render. */
  private readonly t: Translate = (key, params) => this.services.getTranslator().t(key, params);
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
  private readonly savedChatSession: SavedChatSessionController;
  private activePanel: AttestPanel = "chat";
  private isRunning = false;
  private editingMessageIndex: number | null = null;

  private transcriptEl: HTMLElement | null = null;
  private followUpsEl: HTMLElement | null = null;
  private readonly composer: ChatComposerController;
  private readonly savedChatsPopover: SavedChatsPopoverController;
  private activeMessageRenderFrame: number | null = null;

  constructor(leaf: WorkspaceLeaf, services: AttestChatViewServices) {
    super(leaf);
    this.services = services;
    this.citationPopover = new CitationPopoverController({
      hostEl: this.contentEl,
      t: this.t,
      onOpenChunk: (chunk) => void this.openRetrievedChunk(chunk),
    });
    this.diagnosticModal = new DiagnosticReportModalController(
      this.app,
      this.t,
      () => this.services.getTranslator().direction,
    );
    this.answerNoteWriter = new AnswerNoteWriter(this.app, this.t);
    this.toolOutputViewer = new ToolOutputViewer(this.app, this.t);
    this.savedChatSession = new SavedChatSessionController({
      listSavedChats: () => this.services.listSavedChats(),
      loadSavedChat: (id) => this.services.loadSavedChat(id),
      saveChat: (input) => this.services.saveChat(input),
      renameSavedChat: (id, title) => this.services.renameSavedChat(id, title),
      setSavedChatFavorite: (id, isFavorite) => this.services.setSavedChatFavorite(id, isFavorite),
      deleteSavedChat: (id) => this.services.deleteSavedChat(id),
      createSaveInput: () => this.createCurrentChatSaveInput(),
    });
    this.savedChatsPopover = new SavedChatsPopoverController({
      hostEl: this.contentEl,
      getSavedChats: () => this.savedChatSession.savedChats,
      getCurrentChatId: () => this.savedChatSession.currentChatId,
      t: this.t,
      onOpenChat: (id) => void this.loadSavedChat(id),
      onRenameChat: (id, title) => void this.renameSavedChat(id, title),
      onToggleFavorite: (id) => void this.toggleSavedChatFavorite(id),
      onDeleteChat: (id) => void this.deleteSavedChat(id),
      refreshSavedChats: () => this.savedChatSession.refresh(),
    });
    this.composer = new ChatComposerController({
      getSettings: () => this.currentChatSettings,
      getAvailableModels: () => this.services.getChatModelProfiles(),
      getAvailableIndexes: () => this.services.getIndexProfiles(),
      getContextFilePaths: () =>
        this.app.vault
          .getFiles()
          .filter((file) => isContextDocumentPath(file.path))
          .map((file) => file.path)
          .sort(),
      getResearchMode: () => this.currentResearchMode,
      getAttachedContextPaths: () => this.attachedContextPaths,
      isRunning: () => this.isRunning,
      getContextWindowUsage: () => this.getContextWindowUsage(),
      getSearchUnavailableMessage: () => this.getSearchUnavailableMessage(),
      t: this.t,
      onSubmit: () => void this.researchController.submitQuestion(),
      onStop: () => {
        this.researchController.stopRunningQuestion();
        this.composer.setStopping();
      },
      onOpenContextPicker: () => this.openContextPicker(),
      onRemoveContextPath: (path) => this.removeAttachedContextPath(path),
      onUpdateModel: (model) => void this.updateChatModel(model),
      onUpdateIndex: (indexProfileId) => void this.updateIndexProfile(indexProfileId),
      onUpdateContextMode: (contextMode) => void this.updateContextMode(contextMode),
      onUpdateSearchMode: (searchMode) => void this.updateSearchMode(searchMode),
      onUpdateResearchMode: (mode) => void this.updateResearchMode(mode),
    });
    this.researchController = new ResearchQuestionController({
      getQuestionInput: () => this.composer.getQuestionInput(),
      clearQuestionInput: () => this.composer.clearQuestionInput(),
      getMessages: () => this.messages,
      setMessages: (messages) => {
        this.messages = messages;
      },
      getLastAnswer: () => this.lastAnswer,
      setLastAnswer: (answer) => {
        this.lastAnswer = answer;
      },
      getModelInputValue: () => this.composer.getModel(),
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
      getContextPaths: () =>
        expandAttachedContextPaths(
          this.attachedContextPaths,
          this.app.vault.getFiles().map((file) => file.path),
        ),
      clearContextPaths: () => {
        this.attachedContextPaths = [];
        this.composer.renderAttachedContext();
      },
      getSearchUnavailableMessage: () => this.getSearchUnavailableMessage(),
      setEditingMessageIndex: (index) => {
        this.editingMessageIndex = index;
      },
      setProgressStatus: (message) => this.composer.setProgressStatus(message),
      setFormRunning: (running) => this.composer.setFormRunning(running),
      setRunningState: (running) => {
        this.isRunning = running;
      },
      renderMessages: () => this.renderMessages(),
      renderActiveMessage: () => this.scheduleActiveMessageRender(),
      renderAnswerDetails: () => this.renderAnswerDetails(),
      t: this.t,
    });
    this.indexSearch = new IndexSearchController({
      getIndexProfiles: () => this.services.getIndexProfiles(),
      getSelectedIndexProfileId: () => this.currentChatSettings.indexProfileId ?? "",
      getEmbedderWarning: (indexProfileId) =>
        this.services.getIndexSearchEmbedderWarning(indexProfileId),
      searchIndex: (options) => this.services.searchIndex(options),
      onOpenChunk: (chunk) => void this.openRetrievedChunk(chunk),
      t: this.t,
    });
    this.currentChatSettings = createDefaultChatSettings(this.services);
  }

  getViewType(): string {
    return ATTEST_CHAT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Attest";
  }

  getIcon(): string {
    return "bot-message-square";
  }

  async onOpen(): Promise<void> {
    await this.savedChatSession.refresh();
    this.render();
  }

  async onClose(): Promise<void> {
    this.researchController.dispose();
    if (this.activeMessageRenderFrame !== null) {
      window.cancelAnimationFrame(this.activeMessageRenderFrame);
      this.activeMessageRenderFrame = null;
    }
    this.citationPopover.close();
    this.diagnosticModal.close();
    this.savedChatsPopover.close();
    if (this.transcriptEl) {
      disposeChatTranscript(this.transcriptEl);
    }
    this.contentEl.empty();
  }

  redisplay(): void {
    this.render();
  }

  private render(): void {
    this.diagnosticModal.close();
    if (this.transcriptEl) {
      disposeChatTranscript(this.transcriptEl);
    }
    this.contentEl.empty();
    this.contentEl.addClass("attest-chat-view");
    this.contentEl.setAttr("dir", this.services.getTranslator().direction);
    if (!this.services.isDebugMode()) {
      this.activePanel = "chat";
    }

    const root = this.contentEl.createDiv({ cls: "attest-chat" });
    const header = root.createDiv({ cls: "attest-chat__header" });
    header.createEl("h2", { text: "Attest" });
    renderPanelTabs(header, this.headerOptions());

    const chatPanel = root.createDiv({
      cls: `attest-chat__panel${this.activePanel === "chat" ? "" : " is-hidden"}`,
    });
    const chatToolbar = chatPanel.createDiv({ cls: "attest-chat__toolbar" });
    renderChatWindowActions(chatToolbar, this.headerOptions());

    this.transcriptEl = chatPanel.createDiv({
      cls: "attest-chat__transcript",
      attr: { role: "log", "aria-live": "polite" },
    });

    const results = chatPanel.createDiv({ cls: "attest-chat__results" });
    this.followUpsEl = results.createDiv({ cls: "attest-chat__followups" });

    this.composer.render(chatPanel);

    if (this.services.isDebugMode()) {
      const indexSearchRoot = root.createDiv({
        cls: `attest-index-search${this.activePanel === "indexSearch" ? "" : " is-hidden"}`,
      });
      this.indexSearch.render(indexSearchRoot);
    }
    this.renderMessages();
    this.renderAnswerDetails();
  }

  private headerOptions(): Parameters<typeof renderPanelTabs>[1] {
    return {
      activePanel: this.activePanel,
      isDebugMode: this.services.isDebugMode(),
      t: this.t,
      onPanelChange: (panel) => {
        this.activePanel = this.services.isDebugMode() ? panel : "chat";
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
    this.currentResearchMode = this.currentChatSettings.researchMode ?? "instant";
    this.savedChatSession.clearCurrent();
    this.editingMessageIndex = null;
    this.closeHistoryPopover();
    await this.savedChatSession.refresh();
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
      t: this.t,
      getDirection: () => this.services.getTranslator().direction,
      onSubmit: (paths) => {
        this.attachedContextPaths = paths;
        this.composer.renderAttachedContext();
        void this.saveCurrentChat();
      },
    }).open();
  }

  private removeAttachedContextPath(path: string): void {
    this.attachedContextPaths = this.attachedContextPaths.filter((candidate) => candidate !== path);
    this.composer.renderAttachedContext();
    void this.saveCurrentChat();
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
      assistantLabel: this.getCurrentChatModelLabel() || this.t("chat.message.assistant"),
      isDebugMode: this.services.isDebugMode(),
      t: this.t,
      locale: this.services.getTranslator().locale,
      getDirection: () => this.services.getTranslator().direction,
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
      ...(this.services.resolveDocumentImage
        ? { documentImages: { resolve: this.services.resolveDocumentImage } }
        : {}),
    };
  }

  private renderAnswerDetails(): void {
    this.renderFollowUps(this.lastAnswer?.followUpQuestions ?? []);
  }

  private renderEmptyChatState(containerEl: HTMLElement): void {
    renderSavedChatsEmptyState(containerEl, {
      savedChats: this.savedChatSession.savedChats,
      t: this.t,
      onOpenChat: (id) => void this.loadSavedChat(id),
      onViewAll: (anchorEl) => void this.toggleHistoryPopover(anchorEl),
      onRenameChat: (id, title) => this.renameSavedChat(id, title),
      onToggleFavorite: (id) => this.toggleSavedChatFavorite(id),
      onDeleteChat: (id) => this.deleteSavedChat(id),
    });
  }

  private renderFollowUps(followUps: string[]): void {
    if (!this.followUpsEl) {
      return;
    }

    renderChatFollowUps(
      this.followUpsEl,
      followUps,
      (question) => {
        this.composer.setQuestionInput(question);
      },
      this.t,
    );
  }

  private async toggleHistoryPopover(anchorEl: HTMLElement): Promise<void> {
    await this.savedChatsPopover.toggle(anchorEl);
  }

  private async renameSavedChat(id: string, title: string): Promise<void> {
    await this.savedChatSession.rename(id, title);
    if (this.savedChatsPopover.isOpen()) {
      this.savedChatsPopover.render();
    } else {
      this.renderMessages();
    }
  }

  private async deleteSavedChat(id: string): Promise<void> {
    await this.savedChatSession.delete(id);
    if (this.savedChatsPopover.isOpen()) {
      this.savedChatsPopover.render();
    } else {
      this.render();
    }
    new Notice(this.t("chat.notice.chatDeleted"));
  }

  private async toggleSavedChatFavorite(id: string): Promise<void> {
    const chat = this.savedChatSession.savedChats.find((summary) => summary.id === id);
    if (!chat) {
      return;
    }

    await this.savedChatSession.setFavorite(id, !chat.isFavorite);
    if (this.savedChatsPopover.isOpen()) {
      this.savedChatsPopover.render();
    } else {
      this.renderMessages();
    }
  }

  private closeHistoryPopover(): void {
    this.savedChatsPopover.close();
  }

  private async loadSavedChat(id: string): Promise<void> {
    const chat = await this.savedChatSession.load(id);

    if (!chat) {
      new Notice(this.t("chat.notice.savedChatNotFound"));
      await this.savedChatSession.refresh();
      this.render();
      return;
    }

    this.messages = chat.messages;
    this.lastAnswer = chat.lastAnswer;
    this.attachedContextPaths = [...chat.attachedContextPaths];
    this.currentChatSettings = resolveChatSettings(this.services, chat.chatSettings);
    this.currentResearchMode = this.currentChatSettings.researchMode ?? "instant";
    this.editingMessageIndex = null;
    this.closeHistoryPopover();
    await this.savedChatSession.refresh();
    this.render();
  }

  private async saveCurrentChat(): Promise<void> {
    await this.savedChatSession.saveCurrent();
  }

  private createCurrentChatSaveInput(): Omit<SaveChatInput, "id" | "createdAt"> | null {
    if (this.messages.length === 0) {
      return null;
    }

    return {
      title: inferChatTitle(this.messages),
      messages: this.services.isDebugMode()
        ? this.messages
        : stripMessageDiagnostics(this.messages),
      lastAnswer: this.services.isDebugMode()
        ? this.lastAnswer
        : stripContextDiagnostics(this.lastAnswer),
      attachedContextPaths: this.attachedContextPaths,
      chatSettings: this.currentChatSettings,
    };
  }

  private async updateChatModel(model: string): Promise<void> {
    const normalizedModel =
      model.trim() || createDefaultChatSettings(this.services).chatModelProfileId;
    this.currentChatSettings = {
      ...this.currentChatSettings,
      chatModelProfileId: normalizedModel,
    };
    if (this.composer.getModel() !== this.currentChatSettings.chatModelProfileId) {
      this.composer.setModel(this.currentChatSettings.chatModelProfileId);
    }
    await this.saveCurrentChat();
    this.renderMessages();
    this.composer.updateSubmitAvailability();
  }

  private async updateIndexProfile(indexProfileId: string): Promise<void> {
    const normalizedIndex =
      indexProfileId.trim() || (createDefaultChatSettings(this.services).indexProfileId ?? "");
    this.currentChatSettings = {
      ...this.currentChatSettings,
      indexProfileId: normalizedIndex,
    };
    if (this.composer.getIndexProfileId() !== this.currentChatSettings.indexProfileId) {
      this.composer.setIndexProfileId(this.currentChatSettings.indexProfileId ?? "");
    }
    this.warnAboutLegacyIndexImages(normalizedIndex);
    await this.saveCurrentChat();
  }

  /**
   * Non-blocking notice for an index built before document-image metadata
   * existed. Text search still works, so the question is never blocked.
   */
  private warnAboutLegacyIndexImages(indexProfileId: string): void {
    const profile = this.services
      .getIndexProfiles()
      .find((candidate) => candidate.id === indexProfileId);
    const message = profile?.isIndexed ? legacyIndexImageNotice(profile, this.t) : null;
    if (!message) return;

    const notice = new Notice(`${message}\n`, 12_000);
    const action = notice.messageEl.createEl("a", {
      text: this.t("chat.notice.openIndexSettings"),
      href: "#",
      cls: "attest-chat__notice-action",
    });
    action.addEventListener("click", (event) => {
      event.preventDefault();
      this.services.openIndexSettings();
      notice.hide();
    });
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

  private async updateResearchMode(mode: ResearchMode): Promise<void> {
    const researchMode = mode === "thinking" ? "thinking" : "instant";
    this.currentResearchMode = researchMode;
    this.currentChatSettings = { ...this.currentChatSettings, researchMode };
    await this.saveCurrentChat();
  }

  private getSearchMode(): ResearchSearchMode {
    return this.composer.getSearchMode();
  }

  private getSearchUnavailableMessage(): string | null {
    return searchUnavailableMessage(
      {
        chatModelProfileId: this.currentChatSettings.chatModelProfileId,
        indexProfileId: this.currentChatSettings.indexProfileId,
        searchMode: this.getSearchMode(),
        isWebSearchEnabled: this.services.isWebSearchEnabled(),
      },
      this.t,
    );
  }

  private getContextWindowUsage(): { estimatedTokens: number; limitTokens: number } | null {
    return contextWindowUsage({
      question: this.composer.getQuestionInput().trim(),
      messages: this.messages,
      limitTokens: this.getContextLimitTokens(),
      reservedOutputTokens: this.getReservedOutputTokens(),
    });
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
      const url = normalizeExternalUrl(target.target);
      if (!url) return;
      if (this.services.openExternalUrl) {
        await this.services.openExternalUrl(url);
      } else {
        openExternalUrlWithAnchor(url, this.contentEl.ownerDocument);
      }
      return;
    }

    await this.app.workspace.openLinkText(target.target, "", false);
  }

  private async openRetrievedChunk(chunk: RetrievedChunk): Promise<void> {
    await this.openCitation({
      ...formatCitationForChunk(chunk, this.t),
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
      t: this.t,
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

function normalizeExternalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function openExternalUrlWithAnchor(
  url: string,
  ownerDocument: Document = document,
): boolean {
  const normalizedUrl = normalizeExternalUrl(url);
  if (!normalizedUrl) return false;

  const anchor = ownerDocument.createElement("a");
  anchor.href = normalizedUrl;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  ownerDocument.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  return true;
}
