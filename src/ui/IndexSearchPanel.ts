import { setIcon } from "obsidian";

import { RetrievedChunk } from "../shared/types";

export interface IndexSearchPanelRefs {
  indexControlEl: HTMLElement;
  profileEl: HTMLSelectElement;
  queryEl: HTMLTextAreaElement;
  topKEl: HTMLInputElement;
  minScoreEl: HTMLInputElement;
  extensionEl: HTMLInputElement;
  buttonEl: HTMLButtonElement;
  resultsEl: HTMLElement;
}

export interface IndexSearchPanelOptions {
  profiles: Array<{ id: string; name: string; isSuspended?: boolean; isIndexed?: boolean }>;
  selectedProfileId?: string;
  results: RetrievedChunk[];
  error: string | null;
  isSearching: boolean;
  onSubmit(): void;
  onProfileChange?(): void;
  onOpenResult(chunk: RetrievedChunk): void;
}

export function renderIndexSearchPanel(
  containerEl: HTMLElement,
  options: IndexSearchPanelOptions,
): IndexSearchPanelRefs {
  containerEl.empty();

  const indexControlEl = containerEl.createDiv({
    cls: "ixplorer-index-search__index-control",
  });
  const form = containerEl.createEl("form", { cls: "ixplorer-index-search__form" });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    options.onSubmit();
  });

  const profileEl = form.createEl("select", {
    cls: "ixplorer-index-search__profile",
    attr: { "aria-label": "Index profile" },
  });
  for (const profile of options.profiles) {
    const option = profileEl.createEl("option", {
      text: profile.name,
      value: profile.id,
    });
    option.disabled = profile.isSuspended === true || profile.isIndexed !== true;
  }
  const selectedProfile = options.profiles.find(
    (profile) =>
      profile.id === options.selectedProfileId &&
      !profile.isSuspended &&
      profile.isIndexed === true,
  );
  profileEl.value =
    selectedProfile?.id ??
    options.profiles.find((profile) => !profile.isSuspended && profile.isIndexed)?.id ??
    "";
  profileEl.addEventListener("change", () => options.onProfileChange?.());

  const filters = form.createDiv({ cls: "ixplorer-index-search__filters" });
  const topKEl = createLabeledInput(filters, {
    label: "Top K",
    value: "5",
    type: "number",
    min: "1",
    max: "50",
  });
  const minScoreEl = createLabeledInput(filters, {
    label: "Min score",
    value: "0.3",
    type: "number",
    min: "0",
    max: "1",
    step: "0.05",
  });
  const extensionEl = createLabeledInput(filters, {
    label: "Ext",
    value: "",
    type: "text",
    placeholder: "pdf, md",
  });

  const queryRow = form.createDiv({ cls: "ixplorer-index-search__query-row" });
  const queryEl = queryRow.createEl("textarea", {
    cls: "ixplorer-index-search__query",
    attr: {
      rows: "2",
      placeholder: "Enter search query...",
      "aria-label": "Index search query",
    },
  });
  queryEl.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) {
      return;
    }

    event.preventDefault();
    options.onSubmit();
  });
  const buttonEl = queryRow.createEl("button", {
    cls: "ixplorer-index-search__button",
    attr: {
      type: "submit",
      "aria-label": "Search index",
      title: "Search index",
    },
  });
  setIcon(buttonEl, "search");

  const resultsEl = containerEl.createDiv({
    cls: "ixplorer-index-search__results",
    attr: { role: "list" },
  });
  renderIndexSearchResults(resultsEl, options);

  return {
    indexControlEl,
    profileEl,
    queryEl,
    topKEl,
    minScoreEl,
    extensionEl,
    buttonEl,
    resultsEl,
  };
}

export function renderIndexSearchResults(
  containerEl: HTMLElement,
  options: Pick<IndexSearchPanelOptions, "results" | "error" | "isSearching" | "onOpenResult">,
): void {
  containerEl.empty();

  if (options.error) {
    containerEl.createDiv({
      cls: "ixplorer-index-search__empty",
      text: options.error,
    });
    return;
  }

  if (options.isSearching) {
    containerEl.createDiv({
      cls: "ixplorer-index-search__empty",
      text: "Searching index...",
    });
    return;
  }

  if (options.results.length === 0) {
    containerEl.createDiv({
      cls: "ixplorer-index-search__empty",
      text: "No results yet.",
    });
    return;
  }

  for (const chunk of options.results) {
    const item = containerEl.createDiv({
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
      options.onOpenResult(chunk);
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
  const input = label.createEl("input", {
    attr: {
      type: options.type,
      value: options.value,
      ...(options.min ? { min: options.min } : {}),
      ...(options.max ? { max: options.max } : {}),
      ...(options.step ? { step: options.step } : {}),
      ...(options.placeholder ? { placeholder: options.placeholder } : {}),
    },
  });

  return input;
}

export function formatIndexSearchCitation(chunk: RetrievedChunk): string {
  switch (chunk.source.kind) {
    case "markdown":
      return chunk.source.headingPath.length
        ? `${chunk.source.path} > ${chunk.source.headingPath.join(" > ")}`
        : chunk.source.path;
    case "pdf":
      return `${chunk.source.path} p. ${chunk.source.pageNumber}`;
    case "document":
      return chunk.source.path;
    case "web":
      return chunk.source.url;
  }
}
