import { Menu, setIcon } from "obsidian";

import { SavedChatSettings } from "@core/chat/savedChat";
import type { ResearchSearchMode } from "@application/use-cases/research";
import type { ContextMode } from "@core/diagnostics";
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

/** Imperative handle the host view uses to read/sync composer control state. */
export interface ComposerControls {
  getModel(): string;
  setModel(id: string): void;
  getSearchMode(): ResearchSearchMode;
  getIndexProfileId(): string;
  setIndexProfileId(id: string): void;
  getContextMode(): ContextMode;
  /** Disable all settings controls (during an in-flight run). */
  setDisabled(disabled: boolean): void;
  /** Show the Include/Filter control only when context documents are attached. */
  setAttachmentsPresent(present: boolean): void;
}

export interface ChatComposerRefs {
  formEl: HTMLFormElement;
  progressStatusEl: HTMLElement;
  contextIndicatorEl: HTMLElement;
  textareaEl: HTMLTextAreaElement;
  submitButtonEl: HTMLButtonElement;
  submitButtonTooltipEl: HTMLElement;
  attachedContextEl: HTMLElement;
  controls: ComposerControls;
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
}

interface DropdownItem {
  id: string;
  name: string;
}

const SEARCH_MODE_ITEMS: DropdownItem[] = [
  { id: "none", name: "None" },
  { id: "indexOnly", name: "Index" },
  { id: "indexAndWeb", name: "Index + Web" },
  { id: "webOnly", name: "Web" },
];

const CONTEXT_MODE_ITEMS: DropdownItem[] = [
  { id: "include", name: "Include" },
  { id: "filter", name: "Filter" },
];

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

  // Attachments row: chips + the Include/Filter control (only when files attached).
  const attachmentsRowEl = composerPanelEl.createDiv({ cls: "ixplorer-chat__attachments-row" });
  const attachedContextEl = attachmentsRowEl.createDiv({ cls: "ixplorer-chat__attachments" });
  enableHorizontalWheelScroll(attachedContextEl);
  let currentContextMode: ContextMode =
    options.settings.contextMode === "filter" ? "filter" : "include";
  const contextModeDropdown = createMenuDropdown(attachmentsRowEl, {
    cls: "ixplorer-chat__dropdown--context-mode",
    ariaLabel: "Attached context mode",
    placeholder: "Include",
    items: CONTEXT_MODE_ITEMS,
    initialId: currentContextMode,
    onSelect: (id) => {
      currentContextMode = id === "filter" ? "filter" : "include";
      options.onUpdateContextMode(currentContextMode);
    },
  });
  contextModeDropdown.el.parentElement?.toggleClass("is-hidden", true);

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

  // Left cluster: attach + sources (mode selector with a small index sub-button).
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

  let currentSearchMode = getResearchSearchMode(options.settings.searchMode);
  let currentIndexId = options.settings.indexProfileId ?? "";

  const sourcesEl = modelRow.createDiv({ cls: "ixplorer-chat__sources" });
  const sourcesModeDropdown = createMenuDropdown(sourcesEl, {
    cls: "ixplorer-chat__dropdown--sources",
    ariaLabel: "Search sources",
    placeholder: "Sources",
    items: SEARCH_MODE_ITEMS,
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
    cls: "ixplorer-chat__sources-index",
    attr: { type: "button", "aria-label": "Choose index" },
  });
  setIcon(indexButton, "chevron-down");
  indexButton.addEventListener("click", () => {
    if (indexButton.disabled) return;
    const items = usableIndexes();
    if (items.length === 0) return;
    const menu = new Menu();
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
    const rect = indexButton.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom });
  });

  function syncIndexButton(): void {
    const usesIndex = currentSearchMode === "indexOnly" || currentSearchMode === "indexAndWeb";
    const hasIndexes = usableIndexes().length > 0;
    indexButton.toggleClass("is-hidden", !usesIndex);
    indexButton.disabled = !usesIndex || !hasIndexes;
  }
  syncIndexButton();

  // Right cluster: context-window indicator, model selector, submit.
  const contextIndicatorEl = modelRow.createSpan({
    cls: "ixplorer-chat__context-indicator",
    attr: {
      role: "status",
      "aria-label": "Unknown model context window size",
      title: "Unknown model context window size",
    },
  });

  let currentModel = options.settings.chatModelProfileId;
  const modelDropdown = createMenuDropdown(modelRow, {
    cls: "ixplorer-chat__dropdown--model",
    ariaLabel: "Model",
    placeholder: "Model",
    items: options.availableModels
      .filter((model) => !model.isSuspended)
      .map((model) => ({ id: model.id, name: model.name })),
    initialId: currentModel,
    onSelect: (id) => {
      currentModel = id;
      options.onUpdateModel(id);
    },
  });

  const submitButtonTooltipEl = modelRow.createSpan({ cls: "ixplorer-chat__submit-tooltip" });
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

  const controls: ComposerControls = {
    getModel: () => currentModel,
    setModel: (id) => {
      currentModel = id;
      modelDropdown.setValue(id);
    },
    getSearchMode: () => currentSearchMode,
    getIndexProfileId: () => currentIndexId,
    setIndexProfileId: (id) => {
      currentIndexId = id;
    },
    getContextMode: () => currentContextMode,
    setDisabled: (disabled) => {
      modelDropdown.setDisabled(disabled);
      sourcesModeDropdown.setDisabled(disabled);
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
    submitButtonTooltipEl,
    attachedContextEl,
    controls,
  };
}

interface MenuDropdownHandle {
  el: HTMLButtonElement;
  setValue(id: string): void;
  setDisabled(disabled: boolean): void;
}

/** Compact label+caret button that opens an Obsidian Menu of options. */
function createMenuDropdown(
  parentEl: HTMLElement,
  config: {
    cls: string;
    ariaLabel: string;
    placeholder: string;
    items: DropdownItem[];
    initialId: string;
    onSelect(id: string): void;
  },
): MenuDropdownHandle {
  const wrapEl = parentEl.createSpan({ cls: "ixplorer-chat__dropdown-wrap" });
  const buttonEl = wrapEl.createEl("button", {
    cls: `ixplorer-chat__dropdown ${config.cls}`,
    attr: { type: "button", "aria-label": config.ariaLabel },
  });
  const valueEl = buttonEl.createSpan({ cls: "ixplorer-chat__dropdown-value" });
  const caretEl = buttonEl.createSpan({ cls: "ixplorer-chat__dropdown-caret" });
  setIcon(caretEl, "chevron-down");

  let currentId = config.initialId;
  const renderLabel = (): void => {
    const found = config.items.find((item) => item.id === currentId);
    valueEl.setText(found ? found.name : config.placeholder);
    buttonEl.setAttr("title", found ? found.name : config.placeholder);
  };
  renderLabel();

  buttonEl.addEventListener("click", () => {
    if (buttonEl.disabled) return;
    const menu = new Menu();
    for (const item of config.items) {
      menu.addItem((entry) =>
        entry
          .setTitle(item.name)
          .setChecked(item.id === currentId)
          .onClick(() => {
            currentId = item.id;
            renderLabel();
            config.onSelect(item.id);
          }),
      );
    }
    const rect = buttonEl.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom });
  });

  return {
    el: buttonEl,
    setValue: (id) => {
      currentId = id;
      renderLabel();
    },
    setDisabled: (disabled) => {
      buttonEl.disabled = disabled;
    },
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
    const isFolder = path.endsWith("/");
    const chip = containerEl.createSpan({ cls: "ixplorer-chat__attachment" });
    chip.setAttr("title", path);
    setIcon(
      chip.createSpan({ cls: "ixplorer-chat__attachment-icon" }),
      isFolder ? "folder" : "file-text",
    );
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

function isResearchSearchMode(value: string | undefined): value is ResearchSearchMode {
  return (
    value === "none" ||
    value === "indexOnly" ||
    value === "indexAndWeb" ||
    value === "webOnly"
  );
}
