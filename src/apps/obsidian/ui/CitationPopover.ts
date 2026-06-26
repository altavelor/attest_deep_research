import { setIcon } from "obsidian";

import { RetrievedChunk } from "../../../core/model/source";
import { copyToClipboard } from "./clipboard";
import { formatIndexSearchCitation } from "./IndexSearchPanel";

export interface ChatCitationRef {
  number: number;
  chunk: RetrievedChunk;
  chunkIds: Set<string>;
  key: string;
}

export interface CitationPopoverControllerOptions {
  hostEl: HTMLElement;
  onOpenChunk(chunk: RetrievedChunk): void;
  onExpandCitation?(ref: ChatCitationRef): void;
  getExpansionStatus?(ref: ChatCitationRef): string | undefined;
}

export class CitationPopoverController {
  private readonly hostEl: HTMLElement;
  private readonly onOpenChunk: (chunk: RetrievedChunk) => void;
  private readonly onExpandCitation?: (ref: ChatCitationRef) => void;
  private readonly getExpansionStatus?: (ref: ChatCitationRef) => string | undefined;
  private popoverEl: HTMLElement | null = null;
  private closeTimer: number | null = null;

  constructor(options: CitationPopoverControllerOptions) {
    this.hostEl = options.hostEl;
    this.onOpenChunk = options.onOpenChunk;
    this.onExpandCitation = options.onExpandCitation;
    this.getExpansionStatus = options.getExpansionStatus;
  }

  open(anchorEl: HTMLElement, ref: ChatCitationRef): void {
    this.cancelClose();
    this.setHighlight(ref.key, true);
    this.popoverEl?.remove();
    const popover = this.hostEl.createDiv({
      cls: "ixplorer-chat__citation-popover",
      attr: { "data-citation-key": ref.key },
    });
    popover.addEventListener("mouseenter", () => {
      this.cancelClose();
      this.setHighlight(ref.key, true);
    });
    popover.addEventListener("mouseleave", () => this.scheduleClose(ref.key));
    popover.addEventListener("focusin", () => {
      this.cancelClose();
      this.setHighlight(ref.key, true);
    });
    popover.addEventListener("focusout", () => this.scheduleClose(ref.key));
    renderCitationPopoverContent(
      popover,
      ref,
      (chunk) => this.onOpenChunk(chunk),
      this.onExpandCitation,
      this.getExpansionStatus,
    );
    this.popoverEl = popover;
    this.position(anchorEl, popover);
  }

  scheduleClose(key: string): void {
    this.cancelClose();
    this.closeTimer = window.setTimeout(() => {
      this.setHighlight(key, false);
      this.close();
    }, 180);
  }

  cancelClose(): void {
    if (this.closeTimer !== null) {
      window.clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
  }

  close(): void {
    this.cancelClose();
    const key = this.popoverEl?.dataset.citationKey;
    if (key) {
      this.setHighlight(key, false);
    }
    this.popoverEl?.remove();
    this.popoverEl = null;
  }

  setHighlight(key: string, highlighted: boolean): void {
    this.hostEl
      .querySelectorAll<HTMLElement>(`[data-citation-key="${cssEscape(key)}"]`)
      .forEach((element) => element.toggleClass("is-highlighted", highlighted));
  }

  scrollBlockIntoView(key: string): void {
    const block = this.hostEl.querySelector<HTMLElement>(
      `.ixplorer-chat__citation-block[data-citation-key="${cssEscape(key)}"]`,
    );
    const details = block?.closest("details");
    if (details instanceof HTMLDetailsElement) {
      details.open = true;
    }
    block?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    this.setHighlight(key, true);
    window.setTimeout(() => this.setHighlight(key, false), 900);
  }

  private position(anchorEl: HTMLElement, popoverEl: HTMLElement): void {
    const anchorRect = anchorEl.getBoundingClientRect();
    const hostRect = this.hostEl.getBoundingClientRect();
    const popoverRect = popoverEl.getBoundingClientRect();
    const gap = 8;
    const left = Math.min(
      Math.max(anchorRect.left - hostRect.left, gap),
      Math.max(gap, hostRect.width - popoverRect.width - gap),
    );
    const topBelow = anchorRect.bottom - hostRect.top + gap;
    const topAbove = anchorRect.top - hostRect.top - popoverRect.height - gap;
    const top =
      topBelow + popoverRect.height <= hostRect.height || topAbove < gap
        ? topBelow
        : Math.max(gap, topAbove);

    popoverEl.style.left = `${left}px`;
    popoverEl.style.top = `${top}px`;
  }
}

export function buildCitationRefs(evidence: RetrievedChunk[]): ChatCitationRef[] {
  const byKey = new Map<string, ChatCitationRef>();

  for (const chunk of evidence) {
    const key = sourceCitationKey(chunk);
    const existing = byKey.get(key);

    if (existing) {
      existing.chunkIds.add(chunk.id);
      continue;
    }

    byKey.set(key, {
      number: byKey.size + 1,
      chunk,
      chunkIds: new Set([chunk.id]),
      key,
    });
  }

  return Array.from(byKey.values());
}

export function renderCitationBlocks(
  containerEl: HTMLElement,
  refs: ChatCitationRef[],
  options: {
    onOpenChunk(chunk: RetrievedChunk): void;
    onHighlight(key: string, highlighted: boolean): void;
  },
): void {
  const details = containerEl.createEl("details", {
    cls: "ixplorer-chat__citation-blocks",
  });
  details.open = refs.length <= 3;
  details.createEl("summary", {
    cls: "ixplorer-chat__citation-summary",
    text: `Sources used (${refs.length})`,
  });

  for (const ref of refs) {
    const block = details.createDiv({
      cls: "ixplorer-chat__citation-block",
      attr: { role: "link", tabindex: "0", "data-citation-key": ref.key },
    });
    block.addEventListener("click", () => {
      options.onOpenChunk(ref.chunk);
    });
    block.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();
      options.onOpenChunk(ref.chunk);
    });
    block.addEventListener("mouseenter", () => options.onHighlight(ref.key, true));
    block.addEventListener("mouseleave", () => options.onHighlight(ref.key, false));
    block.addEventListener("focus", () => options.onHighlight(ref.key, true));
    block.addEventListener("blur", () => options.onHighlight(ref.key, false));
    renderCitationCard(block, ref, (chunk) => options.onOpenChunk(chunk), {
      cardClass: "",
      linkRole: false,
    });
  }
}

function renderCitationPopoverContent(
  containerEl: HTMLElement,
  ref: ChatCitationRef,
  onOpenChunk: (chunk: RetrievedChunk) => void,
  onExpandCitation: ((ref: ChatCitationRef) => void) | undefined,
  getExpansionStatus: ((ref: ChatCitationRef) => string | undefined) | undefined,
): void {
  const block = containerEl.createDiv({
    cls: "ixplorer-chat__citation-popover-card",
    attr: { role: "link", tabindex: "0" },
  });
  block.addEventListener("click", () => {
    onOpenChunk(ref.chunk);
  });
  block.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    onOpenChunk(ref.chunk);
  });
  renderCitationCard(block, ref, onOpenChunk, { cardClass: "", linkRole: true });
  const actions = containerEl.createDiv({ cls: "ixplorer-chat__citation-popover-actions" });
  const expandButton = actions.createEl("button", {
    cls: "ixplorer-chat__citation-action",
    text: "Expand around this",
    attr: {
      type: "button",
      title:
        ref.chunk.source.kind === "web"
          ? "Adjacent expansion is unavailable for web citations"
          : "Add neighboring vault chunks for regeneration",
    },
  });
  expandButton.disabled = ref.chunk.source.kind === "web" || !onExpandCitation;
  expandButton.addEventListener("click", (event) => {
    event.stopPropagation();
    onExpandCitation?.(ref);
  });
  const status = getExpansionStatus?.(ref);
  if (status) {
    actions.createSpan({ cls: "ixplorer-chat__citation-action-status", text: status });
  }
}

function renderCitationCard(
  block: HTMLElement,
  ref: ChatCitationRef,
  _onOpenChunk: (chunk: RetrievedChunk) => void,
  _options: { cardClass: string; linkRole: boolean },
): void {
  const header = block.createDiv({ cls: "ixplorer-chat__citation-block-header" });
  header.createSpan({ cls: "ixplorer-chat__citation-number", text: String(ref.number) });
  header.createSpan({
    cls: "ixplorer-chat__citation-block-source",
    text: formatIndexSearchCitation(ref.chunk),
  });
  const copyButton = header.createEl("button", {
    cls: "ixplorer-chat__citation-copy",
    attr: {
      type: "button",
      "aria-label": "Copy citation text",
      title: "Copy citation text",
    },
  });
  setIcon(copyButton, "copy");
  copyButton.addEventListener("click", (event) => {
    event.stopPropagation();
    void copyToClipboard(ref.chunk.text);
  });
  block.createDiv({
    cls: "ixplorer-chat__citation-block-text",
    text: ref.chunk.text,
  });
}

function sourceCitationKey(chunk: RetrievedChunk): string {
  switch (chunk.source.kind) {
    case "markdown":
      return [
        "markdown",
        chunk.source.path,
        chunk.source.blockId ?? "",
        chunk.source.headingPath.join("/"),
      ].join(":");
    case "pdf":
      return ["pdf", chunk.source.path, chunk.source.pageNumber].join(":");
    case "document":
      return ["document", chunk.source.path, chunk.source.format].join(":");
    case "web":
      return ["web", chunk.source.url].join(":");
  }
}

function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value.replace(/["\\]/g, "\\$&");
}
