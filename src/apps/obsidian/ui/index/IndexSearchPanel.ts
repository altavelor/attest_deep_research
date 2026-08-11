import { setIcon } from "obsidian";

import { RetrievedChunk } from "@core/model";
import type { Translate } from "@adapters/i18n";

export interface IndexSearchPanelRefs {
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
  warning: string | null;
  isSearchBlocked: boolean;
  isSearching: boolean;
  t: Translate;
  onSubmit(): void;
  onProfileChange?(): void;
  onOpenResult(chunk: RetrievedChunk): void;
}

export function renderIndexSearchPanel(
  containerEl: HTMLElement,
  options: IndexSearchPanelOptions,
): IndexSearchPanelRefs {
  const { t } = options;
  containerEl.empty();

  const form = containerEl.createEl("form", { cls: "attest-index-search__form" });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    options.onSubmit();
  });

  const profileEl = form.createEl("select", {
    cls: "attest-index-search__profile",
    attr: { "aria-label": t("indexSearch.profile.aria") },
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
  profileEl.disabled = !profileEl.value || options.isSearching;
  profileEl.addEventListener("change", () => options.onProfileChange?.());

  const filters = form.createDiv({ cls: "attest-index-search__filters" });
  const topKEl = createLabeledInput(filters, {
    label: t("indexSearch.topK"),
    value: "5",
    type: "number",
    min: "1",
    max: "50",
  });
  const minScoreEl = createLabeledInput(filters, {
    label: t("indexSearch.minScore"),
    value: "0.3",
    type: "number",
    min: "0",
    max: "1",
    step: "0.05",
  });
  const extensionEl = createLabeledInput(filters, {
    label: t("indexSearch.extension"),
    value: "",
    type: "text",
    placeholder: t("indexSearch.extension.placeholder"),
  });

  const queryRow = form.createDiv({ cls: "attest-index-search__query-row" });
  const queryEl = queryRow.createEl("textarea", {
    cls: "attest-index-search__query",
    attr: {
      rows: "2",
      placeholder: t("indexSearch.query.placeholder"),
      "aria-label": t("indexSearch.query.aria"),
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
    cls: "attest-index-search__button",
    attr: {
      type: "submit",
      "aria-label": t("indexSearch.run"),
      title: t("indexSearch.run"),
    },
  });
  setIcon(buttonEl, "search");
  buttonEl.disabled = options.isSearchBlocked || options.isSearching;

  const resultsEl = containerEl.createDiv({
    cls: "attest-index-search__results",
    attr: { role: "list" },
  });
  renderIndexSearchResults(resultsEl, options);

  return {
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
  options: Pick<
    IndexSearchPanelOptions,
    "results" | "error" | "warning" | "isSearching" | "onOpenResult" | "t"
  >,
): void {
  containerEl.empty();

  if (options.warning) {
    containerEl.createDiv({
      cls: "attest-index-search__warning",
      text: options.warning,
      attr: { role: "alert" },
    });
  }

  if (options.error) {
    containerEl.createDiv({
      cls: "attest-index-search__empty",
      text: options.error,
    });
    return;
  }

  if (options.isSearching) {
    containerEl.createDiv({
      cls: "attest-index-search__empty",
      text: options.t("indexSearch.searching"),
    });
    return;
  }

  if (options.results.length === 0) {
    containerEl.createDiv({
      cls: "attest-index-search__empty",
      text: options.t("indexSearch.empty"),
    });
    return;
  }

  for (const chunk of options.results) {
    const item = containerEl.createDiv({
      cls: "attest-index-search__result",
      attr: { role: "listitem" },
    });
    const header = item.createDiv({ cls: "attest-index-search__result-header" });
    const citation = formatIndexSearchCitation(chunk, options.t);
    const openButton = header.createEl("button", {
      cls: "attest-index-search__result-title",
      text: citation,
      attr: { type: "button" },
    });
    openButton.addEventListener("click", () => {
      options.onOpenResult(chunk);
    });
    header.createSpan({
      cls: "attest-index-search__score",
      text: chunk.score.toFixed(3),
    });
    item.createDiv({
      cls: "attest-index-search__snippet",
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
  const label = containerEl.createEl("label", { cls: "attest-index-search__filter" });
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

export function formatIndexSearchCitation(chunk: RetrievedChunk, t: Translate): string {
  switch (chunk.source.kind) {
    case "markdown":
      return chunk.source.headingPath.length
        ? `${chunk.source.path} > ${chunk.source.headingPath.join(" > ")}`
        : chunk.source.path;
    case "pdf":
      return `${chunk.source.path}, ${t("common.pdfPage", { page: chunk.source.pageNumber })}`;
    case "document":
      return chunk.source.path;
    case "web":
      return chunk.source.url;
  }
}
