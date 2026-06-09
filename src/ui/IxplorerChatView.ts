import { ItemView, Notice, WorkspaceLeaf, setIcon } from "obsidian";

import { IndexingState } from "../indexing/IndexingService";
import {
  formatResearchAnswerAppendBlock,
  formatResearchAnswerNote,
  researchAnswerNotePath,
} from "../research/answerFormatter";
import { ResearchService, ResearchStreamEvent } from "../research/ResearchService";
import { toUserMessage } from "../shared/errors";
import { Citation, ResearchAnswer, RetrievedChunk } from "../shared/types";
import { IndexControlActions, renderIndexControl } from "./IndexControl";
import { attachModelDropdown } from "./ModelDropdown";
import { ChatDisplayMessage, citationTarget, nextAssistantMessage } from "./rendering";

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

export class IxplorerChatView extends ItemView {
  private readonly services: IxplorerChatViewServices;
  private messages: ChatDisplayMessage[] = [];
  private lastAnswer: ResearchAnswer | null = null;
  private activePanel: IxplorerPanel = "chat";
  private indexSearchResults: RetrievedChunk[] = [];
  private indexSearchError: string | null = null;
  private isSearchingIndex = false;
  private isRunning = false;

  private transcriptEl: HTMLElement | null = null;
  private indexControlEl: HTMLElement | null = null;
  private indexRevealButtonEl: HTMLButtonElement | null = null;
  private citationsEl: HTMLElement | null = null;
  private followUpsEl: HTMLElement | null = null;
  private saveActionsEl: HTMLElement | null = null;
  private textareaEl: HTMLTextAreaElement | null = null;
  private modelInputEl: HTMLInputElement | null = null;
  private submitButtonEl: HTMLButtonElement | null = null;
  private webSearchEl: HTMLInputElement | null = null;
  private indexSearchRootEl: HTMLElement | null = null;
  private indexSearchProfileEl: HTMLSelectElement | null = null;
  private indexSearchQueryEl: HTMLTextAreaElement | null = null;
  private indexSearchTopKEl: HTMLInputElement | null = null;
  private indexSearchMinScoreEl: HTMLInputElement | null = null;
  private indexSearchExtEl: HTMLInputElement | null = null;
  private indexSearchButtonEl: HTMLButtonElement | null = null;
  private indexSearchResultsEl: HTMLElement | null = null;
  private unsubscribeIndexing: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, services: IxplorerChatViewServices) {
    super(leaf);
    this.services = services;
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
    this.render();
  }

  async onClose(): Promise<void> {
    this.unsubscribeIndexing?.();
    this.unsubscribeIndexing = null;
    this.contentEl.empty();
  }

  private render(): void {
    this.contentEl.empty();
    this.contentEl.addClass("ixplorer-chat-view");

    const root = this.contentEl.createDiv({ cls: "ixplorer-chat" });
    const header = root.createDiv({ cls: "ixplorer-chat__header" });
    header.createEl("h2", { text: "Ixplorer" });
    this.renderPanelTabs(header);

    this.indexControlEl = header.createDiv();
    this.indexRevealButtonEl = header.createEl("button", {
      cls: "ixplorer-chat__index-reveal",
      text: "Show index",
      attr: { type: "button" },
    });
    this.indexRevealButtonEl.addEventListener("click", async () => {
      await this.services.setChatIndexControlShown(true);
      this.renderIndexControl();
    });

    const chatPanel = root.createDiv({
      cls: `ixplorer-chat__panel${this.activePanel === "chat" ? "" : " is-hidden"}`,
    });

    this.transcriptEl = chatPanel.createDiv({
      cls: "ixplorer-chat__transcript",
      attr: { role: "log", "aria-live": "polite" },
    });

    const results = chatPanel.createDiv({ cls: "ixplorer-chat__results" });
    this.citationsEl = results.createDiv({ cls: "ixplorer-chat__citations" });
    this.followUpsEl = results.createDiv({ cls: "ixplorer-chat__followups" });
    this.saveActionsEl = results.createDiv({ cls: "ixplorer-chat__save-actions" });

    chatPanel.createEl("form", { cls: "ixplorer-chat__form" }, (form) => {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        void this.submitQuestion();
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
      modelRow.createEl("label", { text: "Model", attr: { for: "ixplorer-chat-model" } });
      this.modelInputEl = modelRow.createEl("input", {
        cls: "ixplorer-chat__model-input",
        attr: {
          id: "ixplorer-chat-model",
          type: "text",
          placeholder: "Chat model",
        },
      });
      this.modelInputEl.value = this.services.getChatModel();
      this.modelInputEl.addEventListener("change", () => {
        void this.services.setChatModel(this.modelInputEl?.value ?? "");
      });
      attachModelDropdown({
        inputEl: this.modelInputEl,
        containerEl: modelRow,
        getModels: () => this.services.getAvailableChatModels(),
        emptyText: "Refresh models in settings",
        onSelect: (model) => this.services.setChatModel(model),
      });

      const actions = form.createDiv({ cls: "ixplorer-chat__actions" });
      const webLabel = actions.createEl("label", { cls: "ixplorer-chat__toggle" });
      this.webSearchEl = webLabel.createEl("input", {
        attr: { type: "checkbox" },
      });
      this.webSearchEl.checked = this.services.isWebSearchEnabled();
      this.webSearchEl.disabled = !this.services.isWebSearchEnabled();
      webLabel.createSpan({ text: "Web" });

      this.submitButtonEl = actions.createEl("button", {
        cls: "mod-cta",
        text: "Ask",
        attr: { type: "submit" },
      });
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

  private renderIndexControl(): void {
    if (!this.indexControlEl || !this.indexRevealButtonEl) {
      return;
    }

    const shouldShow = this.services.isChatIndexControlShown();
    this.indexControlEl.toggleClass("is-hidden", !shouldShow);
    this.indexRevealButtonEl.toggleClass("is-hidden", shouldShow);

    if (!shouldShow) {
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
      onHide: async () => {
        await this.services.setChatIndexControlShown(false);
        this.renderIndexControl();
      },
    });
  }

  private renderMessages(): void {
    if (!this.transcriptEl) {
      return;
    }

    this.transcriptEl.empty();

    for (const message of this.messages) {
      const messageEl = this.transcriptEl.createDiv({
        cls: `ixplorer-chat__message ixplorer-chat__message--${message.role}`,
      });
      messageEl.createDiv({
        cls: "ixplorer-chat__message-label",
        text: message.role === "user" ? "You" : "Ixplorer",
      });
      messageEl.createDiv({ cls: "ixplorer-chat__message-content", text: message.content });
    }

    this.transcriptEl.scrollTop = this.transcriptEl.scrollHeight;
  }

  private renderAnswerDetails(): void {
    this.renderCitations(this.lastAnswer?.citations ?? []);
    this.renderFollowUps(this.lastAnswer?.followUpQuestions ?? []);
    this.renderSaveActions();
  }

  private renderIndexSearchPanel(): void {
    if (!this.indexSearchRootEl) {
      return;
    }

    this.indexSearchRootEl.empty();
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

  private renderCitations(citations: Citation[]): void {
    if (!this.citationsEl) {
      return;
    }

    this.citationsEl.empty();

    if (citations.length === 0) {
      return;
    }

    this.citationsEl.createEl("h3", { text: "Sources" });
    const list = this.citationsEl.createEl("ol");

    for (const citation of citations) {
      const item = list.createEl("li");
      const button = item.createEl("button", {
        cls: "ixplorer-chat__citation",
        text: citation.label,
        attr: { type: "button" },
      });
      button.addEventListener("click", () => {
        void this.openCitation(citation);
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

  private renderSaveActions(): void {
    if (!this.saveActionsEl) {
      return;
    }

    this.saveActionsEl.empty();

    if (!this.lastAnswer) {
      return;
    }

    const saveNewButton = this.saveActionsEl.createEl("button", {
      text: "New note",
      attr: { type: "button" },
    });
    saveNewButton.addEventListener("click", () => {
      void this.saveAnswerToNewNote();
    });

    const appendButton = this.saveActionsEl.createEl("button", {
      text: "Append active",
      attr: { type: "button" },
    });
    appendButton.addEventListener("click", () => {
      void this.appendAnswerToActiveNote();
    });
  }

  private async submitQuestion(): Promise<void> {
    const question = this.textareaEl?.value.trim() ?? "";

    if (!question || this.isRunning) {
      return;
    }

    this.isRunning = true;
    await this.services.setChatModel(this.modelInputEl?.value ?? this.services.getChatModel());
    this.setFormDisabled(true);
    this.messages = [...this.messages, { role: "user", content: question }];
    this.lastAnswer = null;
    this.renderMessages();
    this.renderAnswerDetails();

    if (this.textareaEl) {
      this.textareaEl.value = "";
    }

    try {
      const service = this.services.createResearchService();

      for await (const event of service.answer({
        question,
        includeWebSearch: this.webSearchEl?.checked === true,
      })) {
        this.applyResearchEvent(event);
      }
    } catch (error) {
      this.messages = nextAssistantMessage(this.messages, toUserMessage(error));
      new Notice(toUserMessage(error));
      this.renderMessages();
    } finally {
      this.isRunning = false;
      this.setFormDisabled(false);
      this.renderIndexControl();
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
        profileId: this.indexSearchProfileEl?.value ?? this.services.getIndexProfiles()[0]?.id ?? "",
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
    if (event.type === "delta") {
      this.messages = nextAssistantMessage(this.messages, event.content);
      this.renderMessages();
      return;
    }

    this.lastAnswer = event.answer;
    this.renderAnswerDetails();
  }

  private setFormDisabled(disabled: boolean): void {
    if (this.submitButtonEl) {
      this.submitButtonEl.disabled = disabled;
      this.submitButtonEl.setText(disabled ? "Thinking" : "Ask");
    }

    if (this.textareaEl) {
      this.textareaEl.disabled = disabled;
    }

    if (this.modelInputEl) {
      this.modelInputEl.disabled = disabled;
    }

    if (this.webSearchEl) {
      this.webSearchEl.disabled = disabled || !this.services.isWebSearchEnabled();
    }
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
