import { setIcon } from "obsidian";

import { SavedChatSettings } from "../chat/ChatStore";
import type { ResearchSearchMode } from "../research/ResearchService";
import type { ContextMode } from "../shared/types";
import { nextHorizontalWheelScrollLeft } from "./horizontalWheelScroll";
import {
  getMentionCandidates,
  MentionCandidate,
} from "./mentionAutocomplete";

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
  contextIndicatorEl: HTMLElement;
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
  contextFilePaths: string[];
  onSubmit(): void;
  onStop(): void;
  onQuestionInput?(): void;
  onOpenContextPicker(): void;
  onUpdateModel(model: string): void;
  onUpdateIndex(indexProfileId: string): void;
  onUpdateContextMode(contextMode: ContextMode): void;
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

  const composerPanelEl = formEl.createDiv({ cls: "ixplorer-chat__composer-panel" });
  const attachedContextEl = composerPanelEl.createDiv({ cls: "ixplorer-chat__attachments" });
  enableHorizontalWheelScroll(attachedContextEl);

  const textareaEl = composerPanelEl.createEl("textarea", {
    cls: "ixplorer-chat__input",
    attr: {
      rows: "1",
      placeholder: "Ask across your vault",
      "aria-label": "Research question",
    },
  });
  const resizeQuestionInput = createTextareaAutoGrow(textareaEl);
  const mentionState = createMentionAutocomplete(composerPanelEl, textareaEl, options);
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

  const modelRow = composerPanelEl.createDiv({ cls: "ixplorer-chat__model-row" });
  const attachButton = modelRow.createEl("button", {
    cls: "ixplorer-chat__icon-button",
    attr: {
      type: "button",
      "aria-label": "Attach context documents",
      title: "Attach context documents",
    },
  });
  setIcon(attachButton, "plus");
  attachButton.addEventListener("click", options.onOpenContextPicker);
  const contextIndicatorEl = modelRow.createSpan({
    cls: "ixplorer-chat__context-indicator",
    attr: {
      role: "status",
      "aria-label": "Unknown model context window size",
      title: "Unknown model context window size",
    },
  });
  const modelControlEl = modelRow.createSpan({
    cls: "ixplorer-chat__select-control ixplorer-chat__select-control--model",
  });
  const modelDisplayEl = modelControlEl.createSpan({ cls: "ixplorer-chat__select-value" });
  const modelInputEl = modelControlEl.createEl("select", {
    cls: "ixplorer-chat__model-input",
    attr: {
      id: "ixplorer-chat-model",
      "aria-label": "Model",
    },
  });
  modelInputEl.createEl("option", {
    text: "Model",
    value: "",
    attr: { disabled: "true" },
  });
  for (const model of options.availableModels) {
    if (model.isSuspended) {
      continue;
    }
    modelInputEl.createEl("option", { text: model.name, value: model.id });
  }
  modelInputEl.value = options.settings.chatModelProfileId;
  updateSelectControlLabel(modelControlEl, modelDisplayEl, modelInputEl);
  modelInputEl.addEventListener("change", () => {
    updateSelectControlLabel(modelControlEl, modelDisplayEl, modelInputEl);
    options.onUpdateModel(modelInputEl.value);
  });

  const searchModeLabel = modelRow.createSpan({
    cls: "ixplorer-chat__select-control ixplorer-chat__select-control--search-mode",
  });
  const searchModeDisplayEl = searchModeLabel.createSpan({ cls: "ixplorer-chat__select-value" });
  const searchModeEl = searchModeLabel.createEl("select", {
    cls: "ixplorer-chat__model-input",
    attr: {
      id: "ixplorer-chat-search-mode",
      "aria-label": "Search mode",
    },
  });
  createSearchModeOptions(searchModeEl);
  searchModeEl.value = options.settings.searchMode;
  updateSelectControlLabel(searchModeLabel, searchModeDisplayEl, searchModeEl);
  searchModeEl.addEventListener("change", () => {
    const searchMode = getResearchSearchMode(searchModeEl.value);
    updateSelectControlLabel(searchModeLabel, searchModeDisplayEl, searchModeEl);
    setIndexControlVisibility(indexControlEl, searchMode);
    options.onUpdateSearchMode(searchMode);
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

  const indexControlEl = modelRow.createSpan({
    cls: "ixplorer-chat__select-control ixplorer-chat__select-control--index",
  });
  const indexDisplayEl = indexControlEl.createSpan({ cls: "ixplorer-chat__select-value" });
  const indexInputEl = indexControlEl.createEl("select", {
    cls: "ixplorer-chat__model-input",
    attr: {
      id: "ixplorer-chat-index",
      "aria-label": "Index",
    },
  });
  indexInputEl.createEl("option", {
    text: "Index",
    value: "",
    attr: { disabled: "true" },
  });
  for (const index of options.availableIndexes) {
    if (index.isSuspended || !index.isIndexed) {
      continue;
    }
    indexInputEl.createEl("option", { text: index.name, value: index.id });
  }
  indexInputEl.value = options.settings.indexProfileId ?? "";
  updateSelectControlLabel(indexControlEl, indexDisplayEl, indexInputEl);
  setIndexControlVisibility(indexControlEl, getResearchSearchMode(searchModeEl.value));
  indexInputEl.addEventListener("change", () => {
    updateSelectControlLabel(indexControlEl, indexDisplayEl, indexInputEl);
    options.onUpdateIndex(indexInputEl.value);
  });

  const contextModeControlEl = modelRow.createSpan({
    cls: "ixplorer-chat__select-control ixplorer-chat__select-control--context-mode",
  });
  const contextModeDisplayEl = contextModeControlEl.createSpan({
    cls: "ixplorer-chat__select-value",
  });
  const contextModeEl = contextModeControlEl.createEl("select", {
    cls: "ixplorer-chat__model-input",
    attr: {
      id: "ixplorer-chat-context-mode",
      "aria-label": "Attached context mode",
      title: "Attached context mode",
    },
  });
  contextModeEl.createEl("option", { text: "Include", value: "include" });
  contextModeEl.createEl("option", { text: "Filter", value: "filter" });
  contextModeEl.value = options.settings.contextMode ?? "include";
  updateSelectControlLabel(contextModeControlEl, contextModeDisplayEl, contextModeEl);
  contextModeEl.addEventListener("change", () => {
    const contextMode = contextModeEl.value === "filter" ? "filter" : "include";
    updateSelectControlLabel(contextModeControlEl, contextModeDisplayEl, contextModeEl);
    options.onUpdateContextMode(contextMode);
  });

  const submitButtonTooltipEl = modelRow.createSpan({
    cls: "ixplorer-chat__submit-tooltip",
  });
  const submitButtonEl = submitButtonTooltipEl.createEl("button", {
    cls: "mod-cta ixplorer-chat__submit",
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

  return {
    formEl,
    progressStatusEl,
    contextIndicatorEl,
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

function createMentionAutocomplete(
  containerEl: HTMLElement,
  textareaEl: HTMLTextAreaElement,
  options: ChatComposerOptions,
): {
  update(): void;
  handleKeydown(event: KeyboardEvent): boolean;
} {
  const autocompleteEl = containerEl.createDiv({
    cls: "ixplorer-chat__mention-autocomplete is-hidden",
    attr: { role: "listbox" },
  });
  let candidates: MentionCandidate[] = [];
  let activeIndex = 0;
  let mentionStart = -1;

  const hide = (): void => {
    autocompleteEl.addClass("is-hidden");
    candidates = [];
    mentionStart = -1;
    activeIndex = 0;
  };

  const insert = (candidate: MentionCandidate): void => {
    const cursor = textareaEl.selectionStart ?? textareaEl.value.length;
    const before = textareaEl.value.slice(0, mentionStart);
    const after = textareaEl.value.slice(cursor);
    const inserted = `@${candidate.insertText}`;
    textareaEl.value = `${before}${inserted} ${after}`;
    const nextCursor = before.length + inserted.length + 1;
    textareaEl.setSelectionRange(nextCursor, nextCursor);
    textareaEl.dispatchEvent(new Event("input"));
    textareaEl.focus();
    hide();
  };

  const render = (): void => {
    autocompleteEl.empty();
    if (candidates.length === 0) {
      hide();
      return;
    }

    autocompleteEl.removeClass("is-hidden");
    candidates.forEach((candidate, index) => {
      const item = autocompleteEl.createEl("button", {
        cls: `ixplorer-chat__mention-option${index === activeIndex ? " is-active" : ""}`,
        text: candidate.label,
        attr: {
          type: "button",
          role: "option",
          "aria-selected": String(index === activeIndex),
        },
      });
      item.addEventListener("mousedown", (event) => {
        event.preventDefault();
        insert(candidate);
      });
    });
  };

  const update = (): void => {
    const cursor = textareaEl.selectionStart ?? textareaEl.value.length;
    const beforeCursor = textareaEl.value.slice(0, cursor);
    const atIndex = beforeCursor.lastIndexOf("@");

    if (atIndex === -1) {
      hide();
      return;
    }

    const token = beforeCursor.slice(atIndex + 1);
    if (/\n/.test(token) || /\s/.test(token)) {
      hide();
      return;
    }

    mentionStart = atIndex;
    const query = token.toLowerCase();
    candidates = getMentionCandidates(query, options.contextFilePaths);
    activeIndex = 0;
    render();
  };

  const handleKeydown = (event: KeyboardEvent): boolean => {
    if (autocompleteEl.hasClass("is-hidden") || candidates.length === 0) {
      return false;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      hide();
      return true;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      activeIndex = Math.min(candidates.length - 1, activeIndex + 1);
      render();
      return true;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      activeIndex = Math.max(0, activeIndex - 1);
      render();
      return true;
    }

    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      insert(candidates[activeIndex]);
      return true;
    }

    return false;
  };

  return { update, handleKeydown };
}

function updateSelectControlLabel(
  controlEl: HTMLElement,
  displayEl: HTMLElement,
  selectEl: HTMLSelectElement,
): void {
  const label = selectEl.selectedOptions[0]?.text ?? "";
  displayEl.setText(label);
  controlEl.style.setProperty("--ixplorer-select-label-ch", String(label.length));
  selectEl.setAttr("title", label);
}

function setIndexControlVisibility(
  indexControlEl: HTMLElement,
  searchMode: ResearchSearchMode,
): void {
  indexControlEl.toggleClass("is-hidden", searchMode === "webOnly" || searchMode === "none");
}

function createTextareaAutoGrow(textareaEl: HTMLTextAreaElement): () => void {
  let minTextareaHeight = 0;

  return () => {
    if (minTextareaHeight === 0) {
      textareaEl.style.height = "auto";
      minTextareaHeight = textareaEl.scrollHeight;
    }

    textareaEl.style.height = "auto";
    const nextHeight = Math.max(minTextareaHeight, textareaEl.scrollHeight);
    textareaEl.style.height = `${nextHeight}px`;
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
): void {
  containerEl.empty();

  for (const path of paths) {
    const chip = containerEl.createSpan({ cls: "ixplorer-chat__attachment" });
    chip.setAttr("title", path);
    setIcon(chip.createSpan({ cls: "ixplorer-chat__attachment-icon" }), "file-text");
    chip.createSpan({ cls: "ixplorer-chat__attachment-name", text: attachmentDisplayName(path) });
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

function attachmentDisplayName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export function getResearchSearchMode(value: string | undefined): ResearchSearchMode {
  return isResearchSearchMode(value) ? value : "indexOnly";
}

function createSearchModeOptions(selectEl: HTMLSelectElement): void {
  const options: Array<{ value: ResearchSearchMode | ""; label: string }> = [
    { value: "", label: "Search" },
    { value: "none", label: "None" },
    { value: "indexOnly", label: "Index only" },
    { value: "indexAndWeb", label: "Index + Web" },
    { value: "webOnly", label: "Web only" },
  ];

  for (const option of options) {
    const optionEl = selectEl.createEl("option", {
      text: option.label,
      value: option.value,
    });
    if (option.value === "") {
      optionEl.disabled = true;
    }
  }
}

function isResearchSearchMode(value: string | undefined): value is ResearchSearchMode {
  return (
    value === "none" ||
    value === "indexOnly" ||
    value === "indexAndWeb" ||
    value === "webOnly"
  );
}
