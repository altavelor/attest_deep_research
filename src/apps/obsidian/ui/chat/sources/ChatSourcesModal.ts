import { App, Modal } from "obsidian";

import type { Translate } from "@adapters/i18n";
import type {
  ConversationEvidenceRevision,
  ConversationSource,
  ConversationSourceRegistry,
} from "@core/chat/sourceRegistry";
import type { RetrievedChunk } from "@core/model";
import { buildBoundedRevisionSearchText } from "@core/chat/sourceRegistry";

export const CHAT_SOURCE_RENDER_BATCH = 50;
export const CHAT_SOURCE_USAGE_RENDER_BATCH = 25;
export const CHAT_SOURCE_SEARCH_SCAN_BATCH = 50;
export const MAX_CHAT_SOURCE_SEARCH_CHARS_PER_REVISION = 4_096;
const SEARCH_DEBOUNCE_MS = 150;
const MAX_TOPICS = 8;
const MAX_SEARCH_TITLE_CHARACTERS = 512;
const MAX_SEARCH_CANONICAL_KEY_CHARACTERS = 1_024;
const MAX_SEARCH_REVISION_ID_CHARACTERS = 256;
const MAX_DISPLAY_TITLE_CHARACTERS = 160;
const MAX_DISPLAY_IDENTITY_CHARACTERS = 240;
const MAX_DISPLAY_REVISION_ID_CHARACTERS = 120;
const MAX_DISPLAY_TOPICS_CHARACTERS = 512;
const MAX_DISPLAY_MESSAGE_ID_CHARACTERS = 120;

export interface ChatSourceSearchProjection {
  source: ConversationSource;
  revision: ConversationEvidenceRevision;
  topics: string;
  searchText: string;
}

export class ChatSourcesModal extends Modal {
  private searchTimer: number | null = null;
  private workTimer: number | null = null;
  private workGeneration = 0;

  constructor(
    app: App,
    private readonly registry: ConversationSourceRegistry,
    private readonly t: Translate,
    private readonly getDirection: () => "ltr" | "rtl",
    private readonly options: {
      targetRevisionId?: string;
      onNavigateMessage(messageId: string): void;
      onOpenChunk(chunk: RetrievedChunk): void;
    },
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.setAttr("dir", this.getDirection());
    this.modalEl.addClass("attest-chat-sources-modal-host");
    this.contentEl.addClass("attest-chat-sources-modal");
    this.contentEl.createEl("h2", { text: this.t("chat.sources.title") });

    if (this.registry.sources.length === 0) {
      this.contentEl.createEl("p", { text: this.t("chat.sources.empty") });
      return;
    }

    const search = this.contentEl.createEl("input", {
      cls: "attest-chat-sources-modal__search",
      attr: {
        type: "search",
        placeholder: this.t("chat.sources.search"),
        "aria-label": this.t("chat.sources.search"),
      },
    });
    const list = this.contentEl.createDiv({ cls: "attest-chat-sources-modal__list" });
    const loadMore = this.contentEl.createEl("button", {
      cls: "attest-chat-sources-modal__load-more",
      text: this.t("chat.sources.loadMore"),
      attr: { type: "button" },
    });
    let matches: ChatSourceSearchProjection[] = [];
    let rendered = 0;
    let desired = CHAT_SOURCE_RENDER_BATCH;
    let focusTarget = this.options.targetRevisionId !== undefined;
    let cursor = createRegistryCursor(this.registry);
    let targetCursor = createRegistryCursor(this.registry);
    let targetFound = this.options.targetRevisionId === undefined;
    const sourceNodes = new Map<string, { details: HTMLDetailsElement; revisions: HTMLElement }>();

    const updateLoadMore = (): void => {
      const hasMore = rendered < matches.length || !cursor.done;
      loadMore.toggleClass("is-hidden", !hasMore);
      loadMore.disabled = !hasMore;
    };
    const renderNext = (): void => {
      const end = Math.min(matches.length, desired);
      for (const entry of matches.slice(rendered, end)) {
        renderProjectionEntry(
          list,
          sourceNodes,
          entry,
          this.t,
          {
            ...this.options,
            onNavigateMessage: (messageId) => {
              this.close();
              this.options.onNavigateMessage(messageId);
            },
            onOpenChunk: (chunk) => {
              this.close();
              this.options.onOpenChunk(chunk);
            },
            onOpenSourceLink: (chunk) => this.options.onOpenChunk(chunk),
          },
          Boolean(search.value),
        );
      }
      rendered = end;
      updateLoadMore();
      if (focusTarget) {
        focusTarget = false;
        focusRevision(list);
      }
    };
    const cancelWork = (): void => {
      this.workGeneration += 1;
      if (this.workTimer !== null) window.clearTimeout(this.workTimer);
      this.workTimer = null;
    };
    const rerenderMatches = (): void => {
      list.empty();
      sourceNodes.clear();
      rendered = 0;
      renderNext();
    };
    const scheduleWork = (work: () => void): void => {
      const generation = this.workGeneration;
      this.workTimer = window.setTimeout(() => {
        this.workTimer = null;
        if (generation === this.workGeneration) work();
      }, 0);
    };
    const scanTarget = (query: string): void => {
      for (let inspected = 0; inspected < CHAT_SOURCE_SEARCH_SCAN_BATCH; inspected += 1) {
        const candidate = targetCursor.next();
        if (!candidate) {
          targetFound = true;
          break;
        }
        if (candidate.revision.id !== this.options.targetRevisionId) continue;
        targetFound = true;
        const projection = projectChatSourceRevision(candidate.source, candidate.revision);
        if ((!query || projection.searchText.includes(query)) && !matches.includes(projection)) {
          matches = [
            projection,
            ...matches.filter((entry) => entry.revision.id !== projection.revision.id),
          ];
          focusTarget = true;
          rerenderMatches();
        }
        break;
      }
      if (!targetFound) scheduleWork(() => scanTarget(query));
    };
    const scanResults = (query: string): void => {
      for (
        let inspected = 0;
        inspected < CHAT_SOURCE_SEARCH_SCAN_BATCH && matches.length < desired;
        inspected += 1
      ) {
        const candidate = cursor.next();
        if (!candidate) break;
        const projection = projectChatSourceRevision(candidate.source, candidate.revision);
        const isTarget = candidate.revision.id === this.options.targetRevisionId;
        if (isTarget) targetFound = true;
        if (!query || projection.searchText.includes(query)) {
          if (isTarget) {
            matches = [
              projection,
              ...matches.filter((entry) => entry.revision.id !== projection.revision.id),
            ];
          } else {
            matches.push(projection);
          }
        }
      }
      renderNext();
      if (matches.length < desired && !cursor.done) {
        scheduleWork(() => scanResults(query));
      } else if (!targetFound) {
        scheduleWork(() => scanTarget(query));
      }
    };
    const resetResults = (): void => {
      cancelWork();
      list.empty();
      sourceNodes.clear();
      rendered = 0;
      desired = CHAT_SOURCE_RENDER_BATCH;
      matches = [];
      cursor = createRegistryCursor(this.registry);
      targetCursor = createRegistryCursor(this.registry);
      targetFound = this.options.targetRevisionId === undefined;
      focusTarget = this.options.targetRevisionId !== undefined;
      const query = search.value.trim().toLowerCase();
      scanResults(query);
    };
    loadMore.addEventListener("click", () => {
      cancelWork();
      desired += CHAT_SOURCE_RENDER_BATCH;
      scanResults(search.value.trim().toLowerCase());
    });
    search.addEventListener("input", () => {
      cancelWork();
      if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(() => {
        this.searchTimer = null;
        resetResults();
      }, SEARCH_DEBOUNCE_MS);
    });
    resetResults();
  }

  onClose(): void {
    if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
    if (this.workTimer !== null) window.clearTimeout(this.workTimer);
    this.searchTimer = null;
    this.workTimer = null;
    this.workGeneration += 1;
    this.contentEl.empty();
  }
}

export function buildChatSourceSearchProjection(
  registry: ConversationSourceRegistry,
): ChatSourceSearchProjection[] {
  return registry.sources.flatMap((source) =>
    source.revisions.map((revision) => projectChatSourceRevision(source, revision)),
  );
}

function projectChatSourceRevision(
  source: ConversationSource,
  revision: ConversationEvidenceRevision,
): ChatSourceSearchProjection {
  const metadata = buildBoundedSearchText(
    [
      source.title.slice(0, MAX_SEARCH_TITLE_CHARACTERS),
      source.identity.canonicalKey.slice(0, MAX_SEARCH_CANONICAL_KEY_CHARACTERS),
      revision.id.slice(0, MAX_SEARCH_REVISION_ID_CHARACTERS),
    ],
    MAX_CHAT_SOURCE_SEARCH_CHARS_PER_REVISION,
  );
  const evidenceBudget = Math.max(
    0,
    MAX_CHAT_SOURCE_SEARCH_CHARS_PER_REVISION - metadata.length - (metadata ? 1 : 0),
  );
  const boundedEvidence = buildBoundedRevisionSearchText(revision, evidenceBudget);
  const topics = topicsFromBoundedText(boundedEvidence);
  const searchText = buildBoundedSearchText(
    [metadata, boundedEvidence],
    MAX_CHAT_SOURCE_SEARCH_CHARS_PER_REVISION,
  )
    .toLowerCase()
    .slice(0, MAX_CHAT_SOURCE_SEARCH_CHARS_PER_REVISION);
  return { source, revision, topics, searchText };
}

function createRegistryCursor(registry: ConversationSourceRegistry): {
  readonly done: boolean;
  next(): { source: ConversationSource; revision: ConversationEvidenceRevision } | undefined;
} {
  let sourceIndex = 0;
  let revisionIndex = 0;
  let done = false;
  return {
    get done() {
      return done;
    },
    next() {
      while (sourceIndex < registry.sources.length) {
        const source = registry.sources[sourceIndex];
        const revision = source.revisions[revisionIndex];
        if (revision) {
          revisionIndex += 1;
          return { source, revision };
        }
        sourceIndex += 1;
        revisionIndex = 0;
      }
      done = true;
      return undefined;
    },
  };
}

export function buildBoundedSearchText(parts: Iterable<string>, maximumCharacters: number): string {
  let remaining = Math.max(0, maximumCharacters);
  const bounded: string[] = [];
  const iterator = parts[Symbol.iterator]();
  while (remaining > 0) {
    const next = iterator.next();
    if (next.done) break;
    if (bounded.length > 0) {
      bounded.push(" ");
      remaining -= 1;
      if (remaining === 0) break;
    }
    const part = next.value.slice(0, remaining);
    bounded.push(part);
    remaining -= part.length;
  }
  return bounded.join("");
}

function topicsFromBoundedText(text: string): string {
  const topics = new Set<string>();
  for (const match of text.toLowerCase().matchAll(/[\p{L}\p{N}]{3,}/gu)) {
    topics.add(match[0]);
    if (topics.size === MAX_TOPICS) break;
  }
  return [...topics].join(", ");
}

function renderProjectionEntry(
  list: HTMLElement,
  sourceNodes: Map<string, { details: HTMLDetailsElement; revisions: HTMLElement }>,
  entry: ChatSourceSearchProjection,
  t: Translate,
  options: {
    targetRevisionId?: string;
    onNavigateMessage(messageId: string): void;
    onOpenChunk(chunk: RetrievedChunk): void;
    onOpenSourceLink(chunk: RetrievedChunk): void;
  },
  searching: boolean,
): void {
  let sourceNode = sourceNodes.get(entry.source.id);
  if (!sourceNode) {
    const details = list.createEl("details", { cls: "attest-chat-sources-modal__source" });
    details.open = searching || entry.revision.id === options.targetRevisionId;
    details.createEl("summary", {
      text: `${boundedDisplayText(entry.source.title, MAX_DISPLAY_TITLE_CHARACTERS)} · ${entry.source.identity.kind}`,
    });
    renderSourceIdentity(details, entry.source, entry.revision.chunks[0], options.onOpenSourceLink);
    sourceNode = {
      details,
      revisions: details.createDiv({ cls: "attest-chat-sources-modal__revision-list" }),
    };
    sourceNodes.set(entry.source.id, sourceNode);
  }
  const revisionDetails = sourceNode.revisions.createEl("details", {
    cls: "attest-chat-sources-modal__revision",
    attr: {
      "data-revision-id": boundedDisplayText(entry.revision.id, MAX_DISPLAY_REVISION_ID_CHARACTERS),
    },
  });
  revisionDetails.open = entry.revision.id === options.targetRevisionId;
  revisionDetails.toggleClass("is-targeted", revisionDetails.open);
  revisionDetails.createEl("summary", {
    text: t("chat.sources.revision", {
      id: boundedDisplayText(entry.revision.id, MAX_DISPLAY_REVISION_ID_CHARACTERS),
      status: t(`chat.sources.status.${entry.revision.status}`),
      date: new Date(entry.revision.capturedAt).toLocaleString(),
    }),
  });
  const renderBody = (): void => {
    if (revisionDetails.dataset.bodyRendered === "true") return;
    revisionDetails.dataset.bodyRendered = "true";
    revisionDetails.createDiv({
      cls: "attest-chat-sources-modal__topics",
      text: t("chat.sources.topics", {
        topics: boundedDisplayText(entry.topics, MAX_DISPLAY_TOPICS_CHARACTERS) || "—",
      }),
    });
    renderOpenSourceAction(revisionDetails, entry.revision, t, options.onOpenChunk);
    renderRevisionUsages(revisionDetails, entry.revision, t, options.onNavigateMessage);
  };
  revisionDetails.addEventListener("toggle", () => {
    if (revisionDetails.open) renderBody();
  });
  if (revisionDetails.open) renderBody();
}

function renderSourceIdentity(
  container: HTMLElement,
  source: ConversationSource,
  firstChunk: RetrievedChunk | undefined,
  onOpenSourceLink: (chunk: RetrievedChunk) => void,
): void {
  const identity = container.createDiv({ cls: "attest-chat-sources-modal__identity" });
  const displayIdentity = boundedDisplayText(
    source.identity.canonicalKey,
    MAX_DISPLAY_IDENTITY_CHARACTERS,
  );
  const externalUrl =
    source.identity.kind === "web" ? normalizeExternalUrl(source.identity.canonicalKey) : null;
  if (!externalUrl) {
    if (source.identity.kind === "web" || !firstChunk) {
      identity.setText(displayIdentity);
      return;
    }

    const link = identity.createEl("a", {
      cls: "internal-link",
      text: displayIdentity,
      href: source.identity.canonicalKey,
      attr: { "data-href": source.identity.canonicalKey },
    });
    link.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onOpenSourceLink(firstChunk);
    });
    return;
  }

  identity.createEl("a", {
    text: displayIdentity,
    href: externalUrl,
    attr: { target: "_blank", rel: "noopener noreferrer" },
  });
}

/** Renders the action that opens the revision's underlying note, PDF, or page. */
function renderOpenSourceAction(
  revisionDetails: HTMLElement,
  revision: ConversationEvidenceRevision,
  t: Translate,
  onOpenChunk: (chunk: RetrievedChunk) => void,
): void {
  const chunk = revision.chunks[0];
  if (!chunk) return;
  const button = revisionDetails.createEl("button", {
    cls: "attest-chat-sources-modal__open-source",
    text: t("chat.sources.openSource"),
    attr: { type: "button", "aria-label": t("chat.sources.openSource") },
  });
  button.addEventListener("click", () => onOpenChunk(chunk));
}

function normalizeExternalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function renderRevisionUsages(
  revisionDetails: HTMLElement,
  revision: ConversationEvidenceRevision,
  t: Translate,
  onNavigateMessage: (messageId: string) => void,
): void {
  const usages = revisionDetails.createDiv({ cls: "attest-chat-sources-modal__usages" });
  usages.createEl("strong", { text: t("chat.sources.usages", { count: revision.usages.length }) });
  const buttons = usages.createDiv({ cls: "attest-chat-sources-modal__usage-buttons" });
  const loadMore = usages.createEl("button", {
    cls: "attest-chat-sources-modal__load-more-usages",
    text: t("chat.sources.loadMoreUsages"),
    attr: { type: "button" },
  });
  let rendered = 0;
  const renderNext = (): void => {
    const end = Math.min(revision.usages.length, rendered + CHAT_SOURCE_USAGE_RENDER_BATCH);
    for (const usage of revision.usages.slice(rendered, end)) {
      const button = buttons.createEl("button", {
        text: boundedDisplayText(usage.messageId, MAX_DISPLAY_MESSAGE_ID_CHARACTERS),
        attr: { type: "button" },
      });
      button.addEventListener("click", () => onNavigateMessage(usage.messageId));
    }
    rendered = end;
    const hasMore = rendered < revision.usages.length;
    loadMore.toggleClass("is-hidden", !hasMore);
    loadMore.disabled = !hasMore;
  };
  loadMore.addEventListener("click", renderNext);
  renderNext();
}

function boundedDisplayText(value: string, maximumCharacters: number): string {
  if (value.length <= maximumCharacters) return value;
  return `${value.slice(0, maximumCharacters - 1).trimEnd()}…`;
}

function focusRevision(list: HTMLElement): void {
  const target = list.querySelector<HTMLElement>(
    ".attest-chat-sources-modal__revision.is-targeted",
  );
  if (!target) return;
  target.tabIndex = -1;
  target.focus();
  target.scrollIntoView?.({ block: "center" });
}
