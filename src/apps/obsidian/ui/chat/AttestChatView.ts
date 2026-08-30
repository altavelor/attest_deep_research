import { ItemView, Notice, WorkspaceLeaf } from "obsidian";

import { SavedChat, SavedChatSettings, SavedChatSummary } from "@core/chat/savedChat";
import type { ResearchMode } from "@core/research";
import { ResearchService } from "@application/use-cases/research";
import type {
  ChatRunRequest,
  ChatRunStartResult,
  ChatSessionChange,
  ChatSessionManager,
  ChatSessionState,
} from "@application/use-cases/chat";
import { isNonTerminalChatSessionStatus } from "@core/chat/chatSession";
import type { ChatSessionStatus } from "@core/chat/chatSession";
import type { ResearchSearchMode } from "@application/use-cases/research";
import { ResearchAnswer } from "@core/answer";
import { Citation } from "@core/model";
import { toUserMessage } from "@core/errors";
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
} from "./chatViewHelpers";
import type { DocumentImageResolver } from "@application/ports";
import type { Translate, UiTranslator } from "@adapters/i18n";
import { legacyIndexImageNotice, searchUnavailableMessage } from "./chatViewStatus";
import { contextWindowUsage } from "./contextWindowUsage";
import { ChatDisplayMessage } from "@core/conversation";
import { citationTarget } from "./conversationFormatting";
import { renderSavedChatsEmptyState } from "./history/SavedChatsPanel";
import { SavedChatSessionController } from "./history/SavedChatSessionController";
import { SavedChatsPopoverController } from "./history/SavedChatsPopoverController";
import { ChatComposerController } from "./ChatComposerController";
import { ChatSourcesModal } from "./sources/ChatSourcesModal";
import type { ConversationSourceRegistry } from "@core/chat/sourceRegistry";

export const ATTEST_CHAT_VIEW_TYPE = "attest-chat";

export type { IndexSearchOptions, IndexSearchResult };

export interface AttestChatCommandAction {
  contextPaths: readonly string[];
  question?: string;
  searchMode?: ResearchSearchMode;
  submit: boolean;
}

export interface AttestChatViewServices {
  createResearchService(
    chatModelProfileId?: string,
    indexProfileId?: string,
    searchMode?: ResearchSearchMode,
  ): ResearchService;
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
  sessions: ChatSessionManager;
  listSavedChats(): Promise<SavedChatSummary[]>;
  loadSavedChat(id: string): Promise<SavedChat | null>;
  renameSavedChat(id: string, title: string): Promise<void>;
  setSavedChatFavorite(id: string, isFavorite: boolean): Promise<void>;
  getTranslator(): UiTranslator;
  logError?(error: unknown): void;
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
  private readonly savedChatSession: SavedChatSessionController;
  private activePanel: AttestPanel = "chat";
  private editingMessageIndex: number | null = null;
  private unsubscribeSessions: (() => void) | null = null;
  private detachSessionView: (() => void) | null = null;
  private selectedSessionId: string | null = null;
  private toolbarEl: HTMLElement | null = null;

  private transcriptEl: HTMLElement | null = null;
  private followUpsEl: HTMLElement | null = null;
  private readonly composer: ChatComposerController;
  private readonly savedChatsPopover: SavedChatsPopoverController;
  private activeMessageRenderFrame: number | null = null;
  private finalizingRenderFrame: number | null = null;
  private highlightTimer: number | null = null;
  private commandActionQueue: Promise<void> = Promise.resolve();

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
      renameSavedChat: (id, title) => this.services.renameSavedChat(id, title),
      setSavedChatFavorite: (id, isFavorite) => this.services.setSavedChatFavorite(id, isFavorite),
    });
    this.savedChatsPopover = new SavedChatsPopoverController({
      hostEl: this.contentEl,
      getSavedChats: () => this.savedChatSession.savedChats,
      getCurrentChatId: () => this.session.chatId,
      t: this.t,
      onOpenChat: (id) => void this.loadSavedChat(id),
      onRenameChat: (id, title) => void this.renameSavedChat(id, title),
      onToggleFavorite: (id) => void this.toggleSavedChatFavorite(id),
      onDeleteChat: (id) => void this.deleteSavedChat(id),
      getChatStatus: (id) => this.chatStatus(id),
      onStopChat: (id) => this.stopChat(id),
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
      getActiveFilePath: () => this.app.workspace.getActiveFile()?.path,
      shouldIncludeActiveFileContext: () => this.services.shouldIncludeActiveFileContext(),
      isRunning: () => this.isRunning,
      getDraft: () => this.session.draft,
      onDraftChange: (draft) => this.sessions.update(this.session.sessionId, { draft }),
      getContextWindowUsage: () => this.getContextWindowUsage(),
      getSearchUnavailableMessage: () => this.getSearchUnavailableMessage(),
      t: this.t,
      onSubmit: () => {
        const activeFilePath = this.app.workspace.getActiveFile()?.path ?? null;
        this.composer.renderAttachedContext(activeFilePath);
        void this.researchController.submitQuestion(activeFilePath);
      },
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
      getSessionId: () => this.session.sessionId,
      isSessionDisplayed: (sessionId) => this.isSessionDisplayed(sessionId),
      getQuestionInput: () => this.composer.getQuestionInput(),
      clearQuestionInput: () => this.composer.clearQuestionInput(),
      getMessages: (sessionId) => this.settingsOwner(sessionId).messages,
      setMessages: (sessionId, messages) => {
        this.sessions.update(sessionId, { messages });
      },
      getModelInputValue: () => this.composer.getModel(),
      getCurrentModel: (sessionId) => this.settingsOf(sessionId).chatModelProfileId,
      getCurrentModelLabel: (sessionId) => this.getCurrentChatModelLabel(sessionId),
      getContextLimitTokens: (sessionId) => this.getContextLimitTokens(sessionId),
      getReservedOutputTokens: (sessionId) => this.getReservedOutputTokens(sessionId),
      isRunning: () => this.isRunning,
      updateChatModel: (sessionId, model) => this.updateChatModel(model, sessionId),
      saveCurrentChat: (sessionId) => this.saveCurrentChat(sessionId),
      createResearchService: (sessionId) => {
        const chatSettings = this.settingsOf(sessionId);
        return this.services.createResearchService(
          chatSettings.chatModelProfileId,
          chatSettings.indexProfileId,
          this.isSessionDisplayed(sessionId)
            ? this.getSearchMode()
            : (chatSettings.searchMode ?? this.getSearchMode()),
        );
      },
      startRun: (sessionId, request) => this.startRun(sessionId, request),
      stopRun: () => this.stopChatSession(this.session.sessionId),
      getActiveFilePath: () => this.app.workspace.getActiveFile()?.path,
      shouldIncludeActiveFileContext: () => this.services.shouldIncludeActiveFileContext(),
      shouldIncludeContextDiagnostics: () => this.services.isDebugMode(),
      getContextPaths: (sessionId) =>
        expandAttachedContextPaths(
          this.settingsOwner(sessionId).attachedContextPaths,
          this.app.vault.getFiles().map((file) => file.path),
        ),
      clearContextPaths: (sessionId) => {
        this.sessions.update(sessionId, { attachedContextPaths: [] });
        if (this.isSessionDisplayed(sessionId)) this.composer.renderAttachedContext();
      },
      getSearchUnavailableMessage: () => this.getSearchUnavailableMessage(),
      setEditingMessageIndex: (index) => {
        this.editingMessageIndex = index;
      },
      setProgressStatus: (message) => this.composer.setProgressStatus(message),
      renderMessages: () => this.renderMessages(),
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
  }

  private get sessions(): ChatSessionManager {
    return this.services.sessions;
  }

  /**
   * The session this view displays, created on demand for a fresh empty chat.
   * Selection belongs to the view, so a second leaf never redirects this one.
   */
  private get session(): ChatSessionState {
    const selected = this.displayedSession;
    if (selected) return selected;
    const created = this.sessions.createSession(createDefaultChatSettings(this.services));
    this.selectSession(created.sessionId);
    return created;
  }

  private isSessionDisplayed(sessionId: string): boolean {
    return this.selectedSessionId === sessionId;
  }

  /** Session state for a scoped operation, falling back to the displayed chat. */
  private settingsOwner(sessionId: string): ChatSessionState {
    return this.sessions.getSession(sessionId) ?? this.session;
  }

  private settingsOf(sessionId: string): SavedChatSettings {
    return this.settingsOwner(sessionId).chatSettings;
  }

  private selectSession(sessionId: string): void {
    this.selectedSessionId = sessionId;
    this.sessions.noteDisplayed(sessionId);
  }

  get displayedSession(): ChatSessionState | undefined {
    return this.selectedSessionId ? this.sessions.getSession(this.selectedSessionId) : undefined;
  }

  private get messages(): ChatDisplayMessage[] {
    return this.session.messages;
  }

  private set messages(messages: ChatDisplayMessage[]) {
    this.sessions.update(this.session.sessionId, { messages });
  }

  private get lastAnswer(): ResearchAnswer | null {
    return this.session.lastAnswer;
  }

  private set lastAnswer(lastAnswer: ResearchAnswer | null) {
    this.sessions.update(this.session.sessionId, { lastAnswer });
  }

  private get sourceRegistry(): ConversationSourceRegistry {
    return this.session.sourceRegistry;
  }

  private set sourceRegistry(sourceRegistry: ConversationSourceRegistry) {
    this.sessions.update(this.session.sessionId, { sourceRegistry });
  }

  private get attachedContextPaths(): string[] {
    return this.session.attachedContextPaths;
  }

  private set attachedContextPaths(attachedContextPaths: string[]) {
    this.sessions.update(this.session.sessionId, { attachedContextPaths });
  }

  private get currentChatSettings(): SavedChatSettings {
    return this.session.chatSettings;
  }

  private set currentChatSettings(chatSettings: SavedChatSettings) {
    this.sessions.update(this.session.sessionId, { chatSettings });
  }

  private get currentResearchMode(): ResearchMode {
    return this.currentChatSettings.researchMode ?? "instant";
  }

  private get isRunning(): boolean {
    return isNonTerminalChatSessionStatus(this.session.status);
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
    this.selectedSessionId = this.sessions.resumableSessionId;
    this.detachSessionView = this.sessions.attachView(() => this.selectedSessionId);
    this.unsubscribeSessions = this.sessions.subscribe((change) => this.onSessionChange(change));
    await this.savedChatSession.refresh();
    this.render();
    void this.sessions.markViewed(this.session.sessionId);
  }

  /**
   * Detaches presentation only. Runtime sessions belong to the plugin, so
   * closing the tab must never cancel a run or drop session state.
   */
  async onClose(): Promise<void> {
    this.unsubscribeSessions?.();
    this.unsubscribeSessions = null;
    this.detachSessionView?.();
    this.detachSessionView = null;
    if (this.activeMessageRenderFrame !== null) {
      window.cancelAnimationFrame(this.activeMessageRenderFrame);
      this.activeMessageRenderFrame = null;
    }
    if (this.finalizingRenderFrame !== null) {
      window.cancelAnimationFrame(this.finalizingRenderFrame);
      this.finalizingRenderFrame = null;
    }
    if (this.highlightTimer !== null) {
      window.clearTimeout(this.highlightTimer);
      this.highlightTimer = null;
    }
    this.citationPopover.close();
    this.diagnosticModal.close();
    this.savedChatsPopover.close();
    if (this.transcriptEl) {
      disposeChatTranscript(this.transcriptEl);
    }
    this.toolbarEl = null;
    this.contentEl.empty();
  }

  redisplay(): void {
    this.render();
  }

  /** The leaf reports its size only once it is laid out; the question field is sized from that. */
  onResize(): void {
    this.composer.resizeQuestionInput();
  }

  runCommand(action: AttestChatCommandAction): Promise<void> {
    const run = this.commandActionQueue.then(() => this.executeCommand(action));
    this.commandActionQueue = run.catch(() => {});
    return run;
  }

  private async executeCommand(action: AttestChatCommandAction): Promise<void> {
    if (this.isRunning) await this.startNewChat();

    if (this.activePanel !== "chat") {
      this.activePanel = "chat";
      this.render();
    }

    this.attachedContextPaths = Array.from(
      new Set([
        ...this.attachedContextPaths,
        ...action.contextPaths.filter((path) => isContextDocumentPath(path)),
      ]),
    );
    this.composer.renderAttachedContext();

    if (action.searchMode) {
      await this.updateSearchMode(action.searchMode);
      this.composer.setSearchMode(action.searchMode);
    }

    if (action.question !== undefined) {
      this.composer.setQuestionInput(action.question);
    } else {
      this.composer.focusQuestionInput();
    }

    if (action.submit) {
      const activeFilePath = this.app.workspace.getActiveFile()?.path ?? null;
      this.composer.renderAttachedContext(activeFilePath);
      await this.researchController.submitQuestion(activeFilePath);
    } else {
      await this.saveCurrentChat();
    }
  }

  private render(): void {
    this.diagnosticModal.close();
    if (this.transcriptEl) {
      disposeChatTranscript(this.transcriptEl);
    }
    this.contentEl.empty();
    this.toolbarEl = null;
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
    this.toolbarEl = chatPanel.createDiv({ cls: "attest-chat__toolbar" });
    renderChatWindowActions(this.toolbarEl, this.headerOptions());

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
    this.composer.setProgressStatus(this.session.progressLabel);
  }

  private renderToolbarActions(): void {
    if (!this.toolbarEl) return;
    this.toolbarEl.empty();
    renderChatWindowActions(this.toolbarEl, this.headerOptions());
  }

  private headerOptions(): Parameters<typeof renderPanelTabs>[1] {
    return {
      activePanel: this.activePanel,
      hasCompletedAnswer:
        this.lastAnswer !== null ||
        this.messages.some(
          (message) => message.role === "assistant" && message.answer !== undefined,
        ),
      isDebugMode: this.services.isDebugMode(),
      historyActivity: this.sessions.activity(this.savedChatSession.savedChats),
      t: this.t,
      onPanelChange: (panel) => {
        this.activePanel = this.services.isDebugMode() ? panel : "chat";
        this.render();
      },
      onOpenHistory: (anchorEl) => {
        void this.toggleHistoryPopover(anchorEl);
      },
      onOpenSources: () => this.openSourcesModal(),
      onNewChat: () => {
        void this.startNewChat();
      },
    };
  }

  private async startNewChat(): Promise<void> {
    await this.saveCurrentChat();
    const previous = this.session;
    const created = this.sessions.createSession(createDefaultChatSettings(this.services));
    this.selectSession(created.sessionId);
    if (previous.sessionId !== created.sessionId) {
      this.sessions.discardSession(previous.sessionId);
    }
    this.editingMessageIndex = null;
    this.closeHistoryPopover();
    await this.savedChatSession.refresh();
    this.render();
  }

  private openSourcesModal(targetRevisionId?: string): void {
    new ChatSourcesModal(
      this.app,
      this.sourceRegistry,
      this.t,
      () => this.services.getTranslator().direction,
      {
        targetRevisionId,
        onNavigateMessage: (messageId) => this.navigateToMessage(messageId),
        onOpenChunk: (chunk) => void this.openRetrievedChunk(chunk),
      },
    ).open();
  }

  private navigateToMessage(messageId: string): void {
    const messageEl = Array.from(
      this.transcriptEl?.querySelectorAll<HTMLElement>("[data-message-id]") ?? [],
    ).find((element) => element.dataset.messageId === messageId);
    if (!messageEl) return;
    messageEl.scrollIntoView({ block: "center", behavior: "smooth" });
    messageEl.addClass("is-highlighted");
    if (this.highlightTimer !== null) window.clearTimeout(this.highlightTimer);
    this.highlightTimer = window.setTimeout(() => {
      this.highlightTimer = null;
      messageEl.removeClass("is-highlighted");
    }, 1_500);
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
    const sessionId = this.session.sessionId;
    if (this.activeMessageRenderFrame !== null) {
      this.sessions.recordRender(sessionId, "coalesced");
      return;
    }
    this.activeMessageRenderFrame = window.requestAnimationFrame(() => {
      this.activeMessageRenderFrame = null;
      this.sessions.recordRender(sessionId, "markdown");
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
      onOpenRegistryRevision: (revisionId) => this.openSourcesModal(revisionId),
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
    this.renderToolbarActions();
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
      getChatStatus: (id) => this.chatStatus(id),
      onStopChat: (id) => this.stopChat(id),
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
    if (!this.sessions.canDeleteChat(id)) {
      new Notice(this.t("chat.session.deleteBlocked"));
      return;
    }

    try {
      await this.sessions.deleteChat(id);
    } catch (error) {
      new Notice(
        this.sessions.canDeleteChat(id)
          ? toUserMessage(error)
          : this.t("chat.session.deleteBlocked"),
      );
      this.refreshSavedChatsDisplay();
      return;
    }

    await this.savedChatSession.refresh();
    this.refreshSavedChatsDisplay();
    new Notice(this.t("chat.notice.chatDeleted"));
  }

  private refreshSavedChatsDisplay(): void {
    if (this.savedChatsPopover.isOpen()) {
      this.savedChatsPopover.render();
    } else {
      this.render();
    }
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
    const existing = this.sessions.getSessionByChatId(id);
    if (!existing) {
      const chat = await this.savedChatSession.load(id);

      if (!chat) {
        new Notice(this.t("chat.notice.savedChatNotFound"));
        await this.savedChatSession.refresh();
        this.render();
        return;
      }

      const adopted = this.sessions.adoptChat(
        chat,
        resolveChatSettings(this.services, chat.chatSettings),
      );
      this.selectSession(adopted.sessionId);
    } else {
      this.selectSession(existing.sessionId);
    }

    this.editingMessageIndex = null;
    this.closeHistoryPopover();
    await this.sessions.markViewed(this.session.sessionId);
    await this.savedChatSession.refresh();
    this.render();
  }

  private chatStatus(chatId: string): ChatSessionStatus {
    const summary = this.savedChatSession.savedChats.find((candidate) => candidate.id === chatId);
    if (summary) return this.sessions.rowStatus(summary);
    const session = this.sessions.getSessionByChatId(chatId);
    return session
      ? this.sessions.rowStatus({ id: chatId, unreadCompletion: session.unreadCompletion })
      : "idle";
  }

  private stopChat(chatId: string): void {
    const session = this.sessions.getSessionByChatId(chatId);
    if (session) this.stopChatSession(session.sessionId);
  }

  private stopChatSession(sessionId: string): void {
    this.sessions.stop(sessionId);
    if (this.session.sessionId === sessionId) {
      this.composer.setStopping();
    }
  }

  private async startRun(sessionId: string, request: ChatRunRequest): Promise<ChatRunStartResult> {
    const result = await this.sessions.start(sessionId, request);
    if (result.started) {
      await this.savedChatSession.refresh();
      this.renderToolbarActions();
    }
    return result;
  }

  /**
   * Applies a session update: the selected chat re-renders, a background chat
   * only refreshes the chat list and the toolbar indicators.
   */
  private onSessionChange(change: ChatSessionChange): void {
    if (change.kind === "error") {
      new Notice(this.failureMessage(change));
      return;
    }

    if (change.sessionId !== this.session.sessionId) {
      if (change.kind === "status") void this.refreshChatActivity();
      return;
    }

    if (change.kind === "active-message") {
      this.scheduleActiveMessageRender();
      return;
    }
    if (change.kind === "progress") {
      this.composer.setProgressStatus(this.session.progressLabel);
      return;
    }
    if (change.kind === "answer") {
      this.renderAnswerDetails();
      return;
    }
    if (change.kind === "messages") {
      this.renderMessagesAfterFinalizingFrame();
      return;
    }
    this.composer.setFormRunning(this.isRunning);
    this.composer.setProgressStatus(this.session.progressLabel);
    void this.refreshChatActivity();
  }

  /**
   * Holds one animation frame while a finalizing checkpoint is on screen so the
   * final answer does not replace it in the same frame it appeared.
   */
  private renderMessagesAfterFinalizingFrame(): void {
    const finalizing = this.transcriptEl?.querySelector(".attest-chat__workflow-node--finalizing");
    if (!finalizing || this.finalizingRenderFrame !== null) {
      this.renderMessages();
      return;
    }
    this.finalizingRenderFrame = window.requestAnimationFrame(() => {
      this.finalizingRenderFrame = null;
      this.renderMessages();
    });
  }

  /** Names the chat when the failure belongs to a session the reader is not viewing. */
  private failureMessage(change: ChatSessionChange): string {
    const message = toUserMessage(change.error);
    if (change.sessionId === this.session.sessionId) return message;
    const title = this.savedChatSession.savedChats.find(
      (summary) => summary.id === change.chatId,
    )?.title;
    return title ? `${title}: ${message}` : message;
  }

  private async refreshChatActivity(): Promise<void> {
    await this.savedChatSession.refresh();
    this.renderToolbarActions();
    if (this.savedChatsPopover.isOpen()) {
      this.savedChatsPopover.render();
    }
  }

  private async saveCurrentChat(sessionId: string = this.session.sessionId): Promise<void> {
    await this.sessions.save(sessionId);
  }

  private async updateChatModel(
    model: string,
    sessionId: string = this.session.sessionId,
  ): Promise<void> {
    const normalizedModel =
      model.trim() || createDefaultChatSettings(this.services).chatModelProfileId;
    this.sessions.update(sessionId, {
      chatSettings: { ...this.settingsOf(sessionId), chatModelProfileId: normalizedModel },
    });
    const displayed = this.isSessionDisplayed(sessionId);
    if (displayed && this.composer.getModel() !== normalizedModel) {
      this.composer.setModel(normalizedModel);
    }
    await this.saveCurrentChat(sessionId);
    if (!displayed) return;
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

  private getContextLimitTokens(sessionId?: string): number | undefined {
    return this.getCurrentChatModelProfile(sessionId)?.contextLength;
  }

  private getReservedOutputTokens(sessionId?: string): number | undefined {
    return this.getCurrentChatModelProfile(sessionId)?.maxTokens;
  }

  private getCurrentChatModelProfile(sessionId?: string): ChatModelSelectOption | undefined {
    const chatModelProfileId =
      sessionId === undefined
        ? this.currentChatSettings.chatModelProfileId
        : this.settingsOf(sessionId).chatModelProfileId;
    return this.services
      .getChatModelProfiles()
      .find((profile) => profile.id === chatModelProfileId);
  }

  private getCurrentChatModelLabel(sessionId?: string): string {
    return chatModelProfileLabel(
      this.services.getChatModelProfiles(),
      sessionId === undefined
        ? this.currentChatSettings.chatModelProfileId
        : this.settingsOf(sessionId).chatModelProfileId,
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
