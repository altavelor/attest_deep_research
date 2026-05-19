import { ItemView, Notice, WorkspaceLeaf } from "obsidian";

import { IndexingState } from "../indexing/IndexingService";
import {
  formatResearchAnswerAppendBlock,
  formatResearchAnswerNote,
  researchAnswerNotePath,
} from "../research/answerFormatter";
import { ResearchService, ResearchStreamEvent } from "../research/ResearchService";
import { toUserMessage } from "../shared/errors";
import { Citation, ResearchAnswer } from "../shared/types";
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
  isChatIndexControlShown(): boolean;
  setChatIndexControlShown(shown: boolean): Promise<void>;
}

export class IxplorerChatView extends ItemView {
  private readonly services: IxplorerChatViewServices;
  private messages: ChatDisplayMessage[] = [];
  private lastAnswer: ResearchAnswer | null = null;
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

    this.transcriptEl = root.createDiv({
      cls: "ixplorer-chat__transcript",
      attr: { role: "log", "aria-live": "polite" },
    });

    const results = root.createDiv({ cls: "ixplorer-chat__results" });
    this.citationsEl = results.createDiv({ cls: "ixplorer-chat__citations" });
    this.followUpsEl = results.createDiv({ cls: "ixplorer-chat__followups" });
    this.saveActionsEl = results.createDiv({ cls: "ixplorer-chat__save-actions" });

    root.createEl("form", { cls: "ixplorer-chat__form" }, (form) => {
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

    this.unsubscribeIndexing?.();
    this.unsubscribeIndexing =
      this.services.subscribeToIndexingState?.(() => {
        this.renderIndexControl();
      }) ?? null;
    this.renderIndexControl();
    this.renderMessages();
    this.renderAnswerDetails();
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
