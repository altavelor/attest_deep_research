import { setIcon } from "obsidian";

import type { ResearchSearchMode } from "@application/use-cases/research";
import type { SavedChatSettings } from "@core/chat/savedChat";
import type { ContextMode } from "@core/diagnostics";
import type { ResearchMode } from "@core/research";
import type { Translate } from "@adapters/i18n";
import {
  ChatComposerRefs,
  ChatModelSelectOption,
  IndexProfileSelectOption,
  renderAttachedContext,
  renderChatComposer,
} from "./ChatComposer";
import { contextWindowStatus } from "./chatViewStatus";
import type { ContextWindowUsage } from "./contextWindowUsage";

export interface ChatComposerControllerOptions {
  getSettings(): SavedChatSettings;
  getAvailableModels(): ChatModelSelectOption[];
  getAvailableIndexes(): IndexProfileSelectOption[];
  getContextFilePaths(): string[];
  getResearchMode(): ResearchMode;
  getAttachedContextPaths(): string[];
  isRunning(): boolean;
  getContextWindowUsage(): ContextWindowUsage | null;
  getSearchUnavailableMessage(): string | null;
  t: Translate;
  onSubmit(): void;
  onStop(): void;
  onOpenContextPicker(): void;
  onRemoveContextPath(path: string): void;
  onUpdateModel(model: string): void;
  onUpdateIndex(indexProfileId: string): void;
  onUpdateContextMode(contextMode: ContextMode): void;
  onUpdateSearchMode(searchMode: ResearchSearchMode): void;
  onUpdateResearchMode(mode: ResearchMode): void;
}

/** Owns chat-composer DOM references, rendering, and submit availability. */
export class ChatComposerController {
  private refs: ChatComposerRefs | null = null;

  constructor(private readonly options: ChatComposerControllerOptions) {}

  render(containerEl: HTMLElement): void {
    const draft = this.getQuestionInput();
    this.refs = renderChatComposer(containerEl, {
      settings: this.options.getSettings(),
      availableModels: this.options.getAvailableModels(),
      availableIndexes: this.options.getAvailableIndexes(),
      contextFilePaths: this.options.getContextFilePaths(),
      researchMode: this.options.getResearchMode(),
      t: this.options.t,
      onSubmit: this.options.onSubmit,
      onStop: this.options.onStop,
      onQuestionInput: () => this.updateSubmitAvailability(),
      onOpenContextPicker: this.options.onOpenContextPicker,
      onUpdateModel: this.options.onUpdateModel,
      onUpdateIndex: this.options.onUpdateIndex,
      onUpdateContextMode: this.options.onUpdateContextMode,
      onUpdateSearchMode: (mode) => {
        this.options.onUpdateSearchMode(mode);
        this.updateSubmitAvailability();
      },
      onUpdateResearchMode: this.options.onUpdateResearchMode,
    });
    this.refs.textareaEl.value = draft;
    this.renderAttachedContext();
    this.setFormRunning(this.options.isRunning());
  }

  getQuestionInput(): string {
    return this.refs?.textareaEl.value ?? "";
  }

  clearQuestionInput(): void {
    if (!this.refs) {
      return;
    }

    this.refs.textareaEl.value = "";
    this.refs.textareaEl.dispatchEvent(new Event("input"));
  }

  setQuestionInput(question: string): void {
    if (!this.refs) {
      return;
    }

    this.refs.textareaEl.value = question;
    this.refs.textareaEl.dispatchEvent(new Event("input"));
    this.refs.textareaEl.focus();
  }

  getModel(): string {
    return this.refs?.controls.getModel() ?? "";
  }

  setModel(model: string): void {
    this.refs?.controls.setModel(model);
  }

  getSearchMode(): ResearchSearchMode {
    return this.refs?.controls.getSearchMode() ?? "indexOnly";
  }

  getContextMode(): ContextMode {
    return this.refs?.controls.getContextMode() ?? "include";
  }

  getIndexProfileId(): string {
    return this.refs?.controls.getIndexProfileId() ?? "";
  }

  setIndexProfileId(indexProfileId: string): void {
    this.refs?.controls.setIndexProfileId(indexProfileId);
  }

  setProgressStatus(message: string | null): void {
    this.refs?.progressStatusEl.setText(message ?? "");
  }

  setFormRunning(running: boolean): void {
    const refs = this.refs;
    if (!refs) {
      return;
    }

    refs.submitButtonEl.disabled = false;
    refs.submitButtonEl.dataset.mode = running ? "stop" : "ask";
    refs.submitButtonEl.empty();
    setIcon(refs.submitButtonEl, running ? "square" : "arrow-up");
    refs.textareaEl.disabled = running;
    refs.controls.setDisabled(running);
    this.updateSubmitAvailability();
  }

  setStopping(): void {
    const submitButtonEl = this.refs?.submitButtonEl;
    if (!submitButtonEl) {
      return;
    }

    submitButtonEl.disabled = true;
    submitButtonEl.dataset.mode = "stop";
    submitButtonEl.empty();
    setIcon(submitButtonEl, "loader");
  }

  renderAttachedContext(): void {
    const refs = this.refs;
    if (!refs) {
      return;
    }

    renderAttachedContext(
      refs.attachedContextEl,
      this.options.getAttachedContextPaths(),
      this.options.onRemoveContextPath,
      this.options.t,
    );
    refs.controls.setAttachmentsPresent(this.options.getAttachedContextPaths().length > 0);
  }

  updateSubmitAvailability(): void {
    const refs = this.refs;
    if (!refs) {
      return;
    }

    this.updateContextWindowIndicator();

    if (this.options.isRunning()) {
      this.setSubmitButtonAvailability(this.options.t("chat.composer.submit.stop"), false, "stop");
      return;
    }

    const unavailableMessage = this.options.getSearchUnavailableMessage();
    if (unavailableMessage !== null) {
      this.setSubmitButtonAvailability(unavailableMessage, true, "ask");
      return;
    }

    this.setSubmitButtonAvailability(this.options.t("chat.composer.submit.ask"), false, "ask");
  }

  private updateContextWindowIndicator(): void {
    const contextIndicatorEl = this.refs?.contextIndicatorEl;
    if (!contextIndicatorEl) {
      return;
    }

    const usage = this.options.getContextWindowUsage();
    if (!usage) {
      const unknown = this.options.t("chat.status.contextWindow.unknown");
      contextIndicatorEl.style.setProperty("--attest-context-used", "0%");
      contextIndicatorEl.setAttr("title", unknown);
      contextIndicatorEl.setAttr("aria-label", unknown);
      return;
    }

    const status = contextWindowStatus(usage.estimatedTokens, usage.limitTokens, this.options.t);
    contextIndicatorEl.style.setProperty("--attest-context-used", `${status.usedPercent}%`);
    contextIndicatorEl.toggleClass("is-warning", status.isWarning);
    contextIndicatorEl.setAttr("title", status.title);
    contextIndicatorEl.setAttr("aria-label", status.ariaLabel);
  }

  private setSubmitButtonAvailability(
    message: string,
    disabled: boolean,
    mode: "ask" | "stop",
  ): void {
    const refs = this.refs;
    if (!refs) {
      return;
    }

    refs.submitButtonEl.disabled = disabled;
    refs.submitButtonEl.dataset.mode = mode;
    refs.submitButtonEl.setAttr("aria-label", message);
  }
}
