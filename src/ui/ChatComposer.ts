import { setIcon } from "obsidian";

import { SavedChatSettings } from "../chat/ChatStore";
import type { ResearchSearchMode } from "../research/ResearchService";

export interface ChatModelSelectOption {
  id: string;
  name: string;
  contextLength?: number;
  maxTokens?: number;
  isSuspended?: boolean;
}

export interface IndexProfileSelectOption {
  id: string;
  name: string;
  isSuspended?: boolean;
  isIndexed?: boolean;
}

export interface ChatComposerRefs {
  formEl: HTMLFormElement;
  progressStatusEl: HTMLElement;
  textareaEl: HTMLTextAreaElement;
  modelInputEl: HTMLSelectElement;
  indexInputEl: HTMLSelectElement;
  submitButtonEl: HTMLButtonElement;
  submitButtonTooltipEl: HTMLElement;
  searchModeEl: HTMLSelectElement;
  deepResearchEl: HTMLInputElement;
  attachedContextEl: HTMLElement;
}

export interface ChatComposerOptions {
  settings: SavedChatSettings;
  availableModels: ChatModelSelectOption[];
  availableIndexes: IndexProfileSelectOption[];
  onSubmit(): void;
  onStop(): void;
  onQuestionInput?(): void;
  onOpenContextPicker(): void;
  onUpdateModel(model: string): void;
  onUpdateIndex(indexProfileId: string): void;
  onUpdateSearchMode(searchMode: ResearchSearchMode): void;
  onUpdateDeepResearch(deepResearch: boolean): void;
}

export function renderChatComposer(
  containerEl: HTMLElement,
  options: ChatComposerOptions,
): ChatComposerRefs {
  const formEl = containerEl.createEl("form", { cls: "ixplorer-chat__form" });
  formEl.addEventListener("submit", (event) => {
    event.preventDefault();
    options.onSubmit();
  });

  const progressStatusEl = formEl.createDiv({
    cls: "ixplorer-chat__progress-status",
    attr: { "aria-live": "polite" },
  });

  const textareaEl = formEl.createEl("textarea", {
    cls: "ixplorer-chat__input",
    attr: {
      rows: "3",
      placeholder: "Ask across your vault",
      "aria-label": "Research question",
    },
  });
  textareaEl.addEventListener("input", () => {
    options.onQuestionInput?.();
  });
  textareaEl.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) {
      return;
    }

    event.preventDefault();
    options.onSubmit();
  });

  const modelRow = formEl.createDiv({ cls: "ixplorer-chat__model-row" });
  const attachButton = modelRow.createEl("button", {
    cls: "ixplorer-chat__icon-button",
    attr: {
      type: "button",
      "aria-label": "Attach context documents",
      title: "Attach context documents",
    },
  });
  setIcon(attachButton, "paperclip");
  attachButton.addEventListener("click", options.onOpenContextPicker);
  modelRow.createEl("label", { text: "Model", attr: { for: "ixplorer-chat-model" } });
  const modelInputEl = modelRow.createEl("select", {
    cls: "ixplorer-chat__model-input",
    attr: {
      id: "ixplorer-chat-model",
    },
  });
  for (const model of options.availableModels) {
    if (model.isSuspended) {
      continue;
    }
    modelInputEl.createEl("option", { text: model.name, value: model.id });
  }
  modelInputEl.value = options.settings.chatModelProfileId;
  modelInputEl.addEventListener("change", () => {
    options.onUpdateModel(modelInputEl.value);
  });

  modelRow.createEl("label", { text: "Index", attr: { for: "ixplorer-chat-index" } });
  const indexInputEl = modelRow.createEl("select", {
    cls: "ixplorer-chat__model-input",
    attr: {
      id: "ixplorer-chat-index",
      "aria-label": "Index profile",
    },
  });
  for (const index of options.availableIndexes) {
    if (index.isSuspended || !index.isIndexed) {
      continue;
    }
    indexInputEl.createEl("option", { text: index.name, value: index.id });
  }
  indexInputEl.value = options.settings.indexProfileId ?? "";
  indexInputEl.addEventListener("change", () => {
    options.onUpdateIndex(indexInputEl.value);
  });
  const attachedContextEl = formEl.createDiv({ cls: "ixplorer-chat__attachments" });

  const searchModeLabel = modelRow.createEl("label", {
    cls: "ixplorer-chat__search-mode",
    attr: { for: "ixplorer-chat-search-mode" },
  });
  searchModeLabel.createSpan({ text: "Search" });
  const searchModeEl = searchModeLabel.createEl("select", {
    cls: "ixplorer-chat__search-mode-select",
    attr: {
      id: "ixplorer-chat-search-mode",
      "aria-label": "Search mode",
    },
  });
  createSearchModeOptions(searchModeEl);
  searchModeEl.value = options.settings.searchMode;
  searchModeEl.addEventListener("change", () => {
    options.onUpdateSearchMode(getResearchSearchMode(searchModeEl.value));
  });

  const deepResearchLabel = modelRow.createEl("label", {
    cls: "ixplorer-chat__deep-research",
    attr: {
      title: "Use deeper multi-query web research",
    },
  });
  const deepResearchEl = deepResearchLabel.createEl("input", {
    attr: {
      type: "checkbox",
      "aria-label": "Deep web research",
    },
  });
  deepResearchEl.checked = options.settings.deepResearch === true;
  deepResearchEl.addEventListener("change", () => {
    options.onUpdateDeepResearch(deepResearchEl.checked);
  });
  deepResearchLabel.createSpan({ text: "Deep" });

  const submitButtonTooltipEl = modelRow.createSpan({
    cls: "ixplorer-chat__submit-tooltip",
  });
  const submitButtonEl = submitButtonTooltipEl.createEl("button", {
    cls: "mod-cta ixplorer-chat__submit",
    text: "Ask",
    attr: { type: "button" },
  });
  submitButtonEl.addEventListener("click", () => {
    if (submitButtonEl.textContent === "Stop") {
      options.onStop();
      return;
    }

    options.onSubmit();
  });

  return {
    formEl,
    progressStatusEl,
    textareaEl,
    modelInputEl,
    indexInputEl,
    submitButtonEl,
    submitButtonTooltipEl,
    searchModeEl,
    deepResearchEl,
    attachedContextEl,
  };
}

export function renderAttachedContext(
  containerEl: HTMLElement,
  paths: string[],
  onRemove: (path: string) => void,
): void {
  containerEl.empty();

  for (const path of paths) {
    const chip = containerEl.createSpan({ cls: "ixplorer-chat__attachment" });
    chip.createSpan({ text: path });
    const removeButton = chip.createEl("button", {
      attr: {
        type: "button",
        "aria-label": `Remove ${path}`,
        title: `Remove ${path}`,
      },
    });
    setIcon(removeButton, "x");
    removeButton.addEventListener("click", () => onRemove(path));
  }
}

export function getResearchSearchMode(value: string | undefined): ResearchSearchMode {
  return isResearchSearchMode(value) ? value : "indexOnly";
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
