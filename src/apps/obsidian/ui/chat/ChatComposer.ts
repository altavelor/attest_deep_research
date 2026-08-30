import { setIcon } from "obsidian";

import { SavedChatSettings } from "@core/chat/savedChat";
import type { ResearchSearchMode } from "@application/use-cases/research";
import type { ResearchMode } from "@core/research";
import type { ContextMode } from "@core/diagnostics";
import type { Translate } from "@adapters/i18n";
import { nextHorizontalWheelScrollLeft } from "./horizontalWheelScroll";
import { createMentionAutocomplete } from "./mentionAutocompleteController";
import { createMenuDropdown, DropdownItem, showDropdownMenu } from "./chatDropdown";

export interface ChatModelSelectOption {
  id: string;
  name: string;
  contextLength?: number;
  maxTokens?: number;
  isSuspended?: boolean;
  supportsAgentMode?: boolean;
}

export interface IndexProfileSelectOption {
  id: string;
  name: string;
  isSuspended?: boolean;
  isIndexed?: boolean;

  indexVersion?: number;
}

export interface ComposerControls {
  getModel(): string;
  setModel(id: string): void;
  getSearchMode(): ResearchSearchMode;
  setSearchMode(mode: ResearchSearchMode): void;
  getResearchMode(): ResearchMode;
  getIndexProfileId(): string;
  setIndexProfileId(id: string): void;
  getContextMode(): ContextMode;

  setDisabled(disabled: boolean): void;

  setAttachmentsPresent(present: boolean): void;
}

export interface ChatComposerRefs {
  formEl: HTMLFormElement;
  progressStatusEl: HTMLElement;
  contextIndicatorEl: HTMLElement;
  textareaEl: HTMLTextAreaElement;
  submitButtonEl: HTMLButtonElement;
  attachedContextEl: HTMLElement;
  controls: ComposerControls;
  resizeQuestionInput(): void;
}

export interface ChatComposerOptions {
  settings: SavedChatSettings;
  availableModels: ChatModelSelectOption[];
  availableIndexes: IndexProfileSelectOption[];
  contextFilePaths: string[];
  researchMode: ResearchMode;
  t: Translate;
  onSubmit(): void;
  onStop(): void;
  onQuestionInput?(): void;
  onOpenContextPicker(): void;
  onUpdateModel(model: string): void;
  onUpdateIndex(indexProfileId: string): void;
  onUpdateContextMode(contextMode: ContextMode): void;
  onUpdateSearchMode(searchMode: ResearchSearchMode): void;
  onUpdateResearchMode(mode: ResearchMode): void;
}

function searchModeItems(t: Translate): DropdownItem[] {
  return [
    { id: "none", name: t("chat.composer.sources.none") },
    { id: "indexOnly", name: t("chat.composer.sources.index") },
    { id: "indexAndWeb", name: t("chat.composer.sources.indexAndWeb") },
    { id: "webOnly", name: t("chat.composer.sources.web") },
  ];
}

function contextModeItems(t: Translate): DropdownItem[] {
  return [
    { id: "include", name: t("chat.composer.contextMode.include") },
    { id: "filter", name: t("chat.composer.contextMode.filter") },
  ];
}

function researchModeItems(t: Translate): DropdownItem[] {
  return [
    { id: "instant", name: t("chat.composer.researchMode.instant") },
    { id: "thinking", name: t("chat.composer.researchMode.thinking") },
  ];
}

export function renderChatComposer(
  containerEl: HTMLElement,
  options: ChatComposerOptions,
): ChatComposerRefs {
  const { t } = options;
  const formEl = containerEl.createEl("form", { cls: "attest-chat__form" });
  formEl.addEventListener("submit", (event) => {
    event.preventDefault();
    options.onSubmit();
  });

  const progressStatusEl = formEl.createDiv({
    cls: "attest-chat__progress-status",
    attr: { "aria-live": "polite" },
  });

  const composerPanelEl = formEl.createDiv({ cls: "attest-chat__composer-panel" });

  const attachmentsRowEl = composerPanelEl.createDiv({ cls: "attest-chat__attachments-row" });
  const attachedContextEl = attachmentsRowEl.createDiv({ cls: "attest-chat__attachments" });
  enableHorizontalWheelScroll(attachedContextEl);
  let currentContextMode: ContextMode =
    options.settings.contextMode === "filter" ? "filter" : "include";
  const contextModeDropdown = createMenuDropdown(attachmentsRowEl, {
    cls: "attest-chat__dropdown--context-mode",
    ariaLabel: t("chat.composer.contextMode.aria"),
    placeholder: t("chat.composer.contextMode.include"),
    items: contextModeItems(t),
    initialId: currentContextMode,
    onSelect: (id) => {
      currentContextMode = id === "filter" ? "filter" : "include";
      options.onUpdateContextMode(currentContextMode);
    },
  });
  contextModeDropdown.el.parentElement?.toggleClass("is-hidden", true);

  const textareaEl = composerPanelEl.createEl("textarea", {
    cls: "attest-chat__input",
    attr: {
      rows: "1",
      placeholder: t("chat.composer.placeholder"),
      "aria-label": t("chat.composer.question.aria"),
    },
  });
  const resizeQuestionInput = createTextareaAutoGrow(textareaEl);
  const mentionState = createMentionAutocomplete(
    composerPanelEl,
    textareaEl,
    options.contextFilePaths,
  );
  textareaEl.addEventListener("input", () => {
    resizeQuestionInput();
    mentionState.update();
    options.onQuestionInput?.();
  });
  textareaEl.addEventListener("keydown", (event) => {
    if (mentionState.handleKeydown(event)) {
      return;
    }
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) {
      return;
    }
    event.preventDefault();
    options.onSubmit();
  });

  const modelRow = composerPanelEl.createDiv({ cls: "attest-chat__model-row" });

  const attachButton = modelRow.createEl("button", {
    cls: "attest-chat__icon-button",
    attr: {
      type: "button",
      "aria-label": t("chat.composer.attach"),
      title: t("chat.composer.attach"),
    },
  });
  setIcon(attachButton, "plus");
  attachButton.addEventListener("click", options.onOpenContextPicker);

  let currentSearchMode = getResearchSearchMode(options.settings.searchMode);
  let currentIndexId = options.settings.indexProfileId ?? "";

  const sourcesEl = modelRow.createDiv({ cls: "attest-chat__sources" });
  const sourcesModeDropdown = createMenuDropdown(sourcesEl, {
    cls: "attest-chat__dropdown--sources",
    ariaLabel: t("chat.composer.sources.aria"),
    placeholder: t("chat.composer.sources.placeholder"),
    items: searchModeItems(t),
    initialId: currentSearchMode,
    onSelect: (id) => {
      currentSearchMode = getResearchSearchMode(id);
      syncIndexButton();
      options.onUpdateSearchMode(currentSearchMode);
    },
  });

  const usableIndexes = (): DropdownItem[] =>
    options.availableIndexes
      .filter((index) => !index.isSuspended && index.isIndexed)
      .map((index) => ({ id: index.id, name: index.name }));

  const indexButton = sourcesEl.createEl("button", {
    cls: "attest-chat__sources-index",
    attr: { type: "button", "aria-label": t("chat.composer.index.aria") },
  });
  setIcon(indexButton, "chevron-down");
  indexButton.addEventListener("click", () => {
    if (indexButton.disabled) return;
    const items = usableIndexes();
    if (items.length === 0) return;
    showDropdownMenu(indexButton, (menu) => {
      for (const item of items) {
        menu.addItem((entry) =>
          entry
            .setTitle(item.name)
            .setChecked(item.id === currentIndexId)
            .onClick(() => {
              currentIndexId = item.id;
              options.onUpdateIndex(item.id);
            }),
        );
      }
    });
  });

  function syncIndexButton(): void {
    const usesIndex = currentSearchMode === "indexOnly" || currentSearchMode === "indexAndWeb";
    const hasIndexes = usableIndexes().length > 0;
    indexButton.toggleClass("is-hidden", !usesIndex);
    indexButton.disabled = !usesIndex || !hasIndexes;
  }
  syncIndexButton();

  let currentResearchMode: Extract<ResearchMode, "instant" | "thinking"> =
    options.researchMode === "thinking" ? "thinking" : "instant";
  const researchModeDropdown = createMenuDropdown(modelRow, {
    cls: "attest-chat__dropdown--research-mode",
    menuCls: "attest-chat__research-menu",
    ariaLabel: t("chat.composer.researchMode.aria"),
    placeholder: t("chat.composer.researchMode.instant"),
    items: researchModeItems(t),
    initialId: currentResearchMode,
    onSelect: (id) => {
      currentResearchMode = id === "thinking" ? "thinking" : "instant";
      options.onUpdateResearchMode(currentResearchMode);
    },
  });

  const contextIndicatorEl = modelRow.createSpan({
    cls: "attest-chat__context-indicator",
    attr: {
      role: "status",
      "aria-label": t("chat.status.contextWindow.unknown"),
      title: t("chat.status.contextWindow.unknown"),
    },
  });

  let currentModel = options.settings.chatModelProfileId;
  const modelDropdown = createMenuDropdown(modelRow, {
    cls: "attest-chat__dropdown--model",
    ariaLabel: t("chat.composer.model.aria"),
    placeholder: t("chat.composer.model.placeholder"),
    items: options.availableModels
      .filter((model) => !model.isSuspended)
      .map((model) => ({ id: model.id, name: model.name })),
    initialId: currentModel,
    onSelect: (id) => {
      currentModel = id;
      options.onUpdateModel(id);
      syncResearchModeAvailability();
    },
  });

  function syncResearchModeAvailability(): void {
    const supportsAgent =
      options.availableModels.find((model) => model.id === currentModel)?.supportsAgentMode ===
      true;
    researchModeDropdown.setItemDisabled(
      "thinking",
      supportsAgent ? undefined : t("chat.composer.researchMode.thinkingBlocked"),
    );
    if (!supportsAgent && currentResearchMode === "thinking") {
      currentResearchMode = "instant";
      researchModeDropdown.setValue("instant");
      options.onUpdateResearchMode("instant");
    }
  }
  syncResearchModeAvailability();

  const submitButtonEl = modelRow.createEl("button", {
    cls: "mod-cta attest-chat__submit",
    attr: { type: "button" },
  });
  setIcon(submitButtonEl, "arrow-up");
  submitButtonEl.dataset.mode = "ask";
  submitButtonEl.addEventListener("click", () => {
    if (submitButtonEl.dataset.mode === "stop") {
      options.onStop();
      return;
    }
    options.onSubmit();
  });
  resizeQuestionInput();

  const controls: ComposerControls = {
    getModel: () => currentModel,
    setModel: (id) => {
      currentModel = id;
      modelDropdown.setValue(id);
      syncResearchModeAvailability();
    },
    getSearchMode: () => currentSearchMode,
    setSearchMode: (mode) => {
      currentSearchMode = mode;
      sourcesModeDropdown.setValue(mode);
    },
    getResearchMode: () => currentResearchMode,
    getIndexProfileId: () => currentIndexId,
    setIndexProfileId: (id) => {
      currentIndexId = id;
    },
    getContextMode: () => currentContextMode,
    setDisabled: (disabled) => {
      modelDropdown.setDisabled(disabled);
      sourcesModeDropdown.setDisabled(disabled);
      researchModeDropdown.setDisabled(disabled);
      contextModeDropdown.setDisabled(disabled);
      indexButton.disabled = disabled || indexButton.hasClass("is-hidden");
      attachButton.disabled = disabled;
    },
    setAttachmentsPresent: (present) => {
      contextModeDropdown.el.parentElement?.toggleClass("is-hidden", !present);
    },
  };

  return {
    formEl,
    progressStatusEl,
    contextIndicatorEl,
    textareaEl,
    submitButtonEl,
    attachedContextEl,
    controls,
    resizeQuestionInput,
  };
}

/**
 * Grows the question field with its content. A composer built before its leaf
 * has been laid out measures zero, so the height is left to the stylesheet
 * until a real measurement arrives: pinning zero would hide the field with no
 * way to click back into it.
 */
function createTextareaAutoGrow(textareaEl: HTMLTextAreaElement): () => void {
  let minTextareaHeight = 0;

  return () => {
    textareaEl.style.height = "auto";
    const measuredHeight = textareaEl.scrollHeight;
    if (measuredHeight <= 0) {
      textareaEl.style.removeProperty("height");
      return;
    }

    if (minTextareaHeight === 0) {
      minTextareaHeight = measuredHeight;
    }

    textareaEl.style.height = `${Math.max(minTextareaHeight, measuredHeight)}px`;
  };
}

function enableHorizontalWheelScroll(containerEl: HTMLElement): void {
  containerEl.addEventListener(
    "wheel",
    (event) => {
      const nextScrollLeft = nextHorizontalWheelScrollLeft({
        clientWidth: containerEl.clientWidth,
        scrollWidth: containerEl.scrollWidth,
        scrollLeft: containerEl.scrollLeft,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
      });

      if (nextScrollLeft === null) {
        return;
      }

      event.preventDefault();
      containerEl.scrollLeft = nextScrollLeft;
    },
    { passive: false },
  );
}

export function renderAttachedContext(
  containerEl: HTMLElement,
  paths: string[],
  onRemove: (path: string) => void,
  t: Translate,
  activeFilePath?: string,
): void {
  containerEl.empty();

  for (const path of paths) {
    const isFolder = path.endsWith("/");
    const isAutomaticActiveFile = path === activeFilePath;
    const chip = containerEl.createSpan({ cls: "attest-chat__attachment" });
    chip.setAttr("title", path);
    setIcon(
      chip.createSpan({ cls: "attest-chat__attachment-icon" }),
      isFolder ? "folder" : "file-text",
    );
    chip.createSpan({ cls: "attest-chat__attachment-name", text: attachmentDisplayName(path) });
    if (!isAutomaticActiveFile) {
      const removeLabel = t("chat.composer.attachment.remove", { path });
      const removeButton = chip.createEl("button", {
        attr: {
          type: "button",
          "aria-label": removeLabel,
          title: removeLabel,
        },
      });
      setIcon(removeButton, "x");
      removeButton.addEventListener("click", () => onRemove(path));
    }
  }
}

function attachmentDisplayName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export function getResearchSearchMode(value: string | undefined): ResearchSearchMode {
  return isResearchSearchMode(value) ? value : "indexOnly";
}

function isResearchSearchMode(value: string | undefined): value is ResearchSearchMode {
  return (
    value === "none" || value === "indexOnly" || value === "indexAndWeb" || value === "webOnly"
  );
}
