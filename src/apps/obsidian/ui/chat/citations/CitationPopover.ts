import { setIcon } from "obsidian";

import { RetrievedChunk } from "@core/model";
import type { Translate } from "@adapters/i18n";
import { copyToClipboard } from "@apps/obsidian/ui/shared/clipboard";
import { formatIndexSearchCitation } from "@apps/obsidian/ui/index/IndexSearchPanel";
import { isLinkOnlyChunk } from "./citationEvidence";

export interface ChatCitationRef {
  number: number;
  chunk: RetrievedChunk;
  chunkIds: Set<string>;
  key: string;
}

export interface CitationPopoverControllerOptions {
  hostEl: HTMLElement;
  t: Translate;
  onOpenChunk(chunk: RetrievedChunk): void;
}

export class CitationPopoverController {
  private readonly hostEl: HTMLElement;
  private readonly t: Translate;
  private readonly onOpenChunk: (chunk: RetrievedChunk) => void;
  private popoverEl: HTMLElement | null = null;
  private closeTimer: number | null = null;
  private highlightTimer: number | null = null;
  private highlightTimerKey: string | null = null;

  constructor(options: CitationPopoverControllerOptions) {
    this.hostEl = options.hostEl;
    this.t = options.t;
    this.onOpenChunk = options.onOpenChunk;
  }

  open(anchorEl: HTMLElement, ref: ChatCitationRef): void {
    this.cancelClose();
    this.setHighlight(ref.key, true);
    this.popoverEl?.remove();
    const popover = this.hostEl.createDiv({
      cls: "attest-chat__citation-popover",
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
    renderCitationPopoverContent(popover, ref, (chunk) => this.onOpenChunk(chunk), this.t);
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
    if (this.highlightTimer !== null) {
      window.clearTimeout(this.highlightTimer);
      this.highlightTimer = null;
      if (this.highlightTimerKey) this.setHighlight(this.highlightTimerKey, false);
      this.highlightTimerKey = null;
    }
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
      `.attest-chat__citation-block[data-citation-key="${cssEscape(key)}"]`,
    );
    const details = block?.closest("details");
    if (details instanceof HTMLDetailsElement) {
      details.open = true;
    }
    block?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    this.setHighlight(key, true);
    if (this.highlightTimer !== null) window.clearTimeout(this.highlightTimer);
    this.highlightTimerKey = key;
    this.highlightTimer = window.setTimeout(() => {
      this.highlightTimer = null;
      this.highlightTimerKey = null;
      this.setHighlight(key, false);
    }, 900);
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
    t: Translate;
    onOpenChunk(chunk: RetrievedChunk): void;
    onHighlight(key: string, highlighted: boolean): void;
  },
): void {
  const details = containerEl.createEl("details", {
    cls: "attest-chat__citation-blocks",
  });
  details.open = refs.length <= 3;
  details.createEl("summary", {
    cls: "attest-chat__citation-summary",
    text: options.t("chat.citation.sourcesUsed", { count: refs.length }),
  });

  for (const ref of refs) {
    const block = details.createDiv({
      cls: "attest-chat__citation-block",
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
    renderCitationCard(block, ref, options.t);
  }
}

function renderCitationPopoverContent(
  containerEl: HTMLElement,
  ref: ChatCitationRef,
  onOpenChunk: (chunk: RetrievedChunk) => void,
  t: Translate,
): void {
  const block = containerEl.createDiv({
    cls: "attest-chat__citation-popover-card",
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
  renderCitationCard(block, ref, t);
}

function renderCitationCard(block: HTMLElement, ref: ChatCitationRef, t: Translate): void {
  const header = block.createDiv({ cls: "attest-chat__citation-block-header" });
  header.createSpan({ cls: "attest-chat__citation-number", text: String(ref.number) });
  header.createSpan({
    cls: "attest-chat__citation-block-source",
    text: formatIndexSearchCitation(ref.chunk, t),
  });
  if (isLinkOnlyChunk(ref.chunk)) return;

  const copyButton = header.createEl("button", {
    cls: "attest-chat__citation-copy",
    attr: {
      type: "button",
      "aria-label": t("chat.citation.copy"),
      title: t("chat.citation.copy"),
    },
  });
  setIcon(copyButton, "copy");
  copyButton.addEventListener("click", (event) => {
    event.stopPropagation();
    void copyToClipboard(ref.chunk.text, t);
  });
  block.createDiv({
    cls: "attest-chat__citation-block-text",
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
