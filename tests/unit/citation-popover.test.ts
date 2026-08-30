// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTranslator } from "@adapters/i18n";
import {
  buildCitationRefs,
  CitationPopoverController,
  renderCitationBlocks,
} from "@apps/obsidian/ui/chat/citations/CitationPopover";
import { createContainer, installObsidianDomHelpers, resetDom } from "../helpers/domHarness";

const t = createTranslator("en").t;

const chunk = (id: string, text = "Evidence text") => ({
  id,
  text,
  score: 1,
  contentHash: id,
  source: {
    id: "source-plan",
    kind: "markdown" as const,
    title: "Plan",
    path: "Notes/Plan.md",
    headingPath: ["Research"],
  },
});

describe("CitationPopover", () => {
  beforeEach(installObsidianDomHelpers);
  afterEach(resetDom);

  it("groups chunks from the same source and makes citation blocks keyboard-accessible", () => {
    const refs = buildCitationRefs([
      chunk("first"),
      chunk("second"),
      {
        ...chunk("web"),
        source: {
          id: "web-source",
          kind: "web" as const,
          title: "Web",
          url: "https://example.com",
          snippet: "",
          retrievedAt: "now",
          wasContentFetched: true,
        },
      },
    ]);
    const onOpenChunk = vi.fn();
    const onHighlight = vi.fn();
    const container = createContainer();

    renderCitationBlocks(container, refs, { t, onOpenChunk, onHighlight });
    const blocks = container.querySelectorAll<HTMLElement>(".attest-chat__citation-block");
    expect(refs).toHaveLength(2);
    expect(refs[0]?.chunkIds).toEqual(new Set(["first", "second"]));
    expect(blocks).toHaveLength(2);
    blocks[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    blocks[0]!.dispatchEvent(new Event("mouseenter"));
    blocks[0]!.dispatchEvent(new Event("mouseleave"));

    expect(onOpenChunk).toHaveBeenCalledWith(refs[0]?.chunk);
    expect(onHighlight).toHaveBeenNthCalledWith(1, refs[0]?.key, true);
    expect(onHighlight).toHaveBeenNthCalledWith(2, refs[0]?.key, false);
  });

  it("opens, highlights, and closes a positioned citation popover", () => {
    const host = createContainer();
    const anchor = host.createEl("button", {
      attr: { "data-citation-key": "markdown:Notes/Plan.md::Research" },
    });
    const onOpenChunk = vi.fn();
    const controller = new CitationPopoverController({ hostEl: host, t, onOpenChunk });
    const ref = buildCitationRefs([chunk("first")])[0]!;

    controller.open(anchor, ref);
    const popover = host.querySelector<HTMLElement>(".attest-chat__citation-popover");
    expect(popover).not.toBeNull();
    expect(popover!.style.getPropertyValue("--attest-popover-left")).toBe("8px");
    expect(popover!.style.getPropertyValue("--attest-popover-top")).toBe("8px");
    expect(anchor.classList.contains("is-highlighted")).toBe(true);
    popover!.querySelector<HTMLElement>(".attest-chat__citation-popover-card")!.click();
    expect(onOpenChunk).toHaveBeenCalledWith(ref.chunk);

    controller.close();
    expect(host.querySelector(".attest-chat__citation-popover")).toBeNull();
    expect(anchor.classList.contains("is-highlighted")).toBe(false);
  });

  it("cancels a pending highlight timer when closed", () => {
    vi.useFakeTimers();
    try {
      const host = createContainer();
      const block = host.createDiv({
        cls: "attest-chat__citation-block",
        attr: { "data-citation-key": "source" },
      });
      const controller = new CitationPopoverController({ hostEl: host, t, onOpenChunk: vi.fn() });

      controller.scrollBlockIntoView("source");
      expect(block.classList.contains("is-highlighted")).toBe(true);
      controller.close();
      vi.runAllTimers();

      expect(block.classList.contains("is-highlighted")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the previous temporary highlight when scrolling to another citation", () => {
    vi.useFakeTimers();
    try {
      const host = createContainer();
      const first = host.createDiv({
        cls: "attest-chat__citation-block",
        attr: { "data-citation-key": "first" },
      });
      const second = host.createDiv({
        cls: "attest-chat__citation-block",
        attr: { "data-citation-key": "second" },
      });
      const controller = new CitationPopoverController({ hostEl: host, t, onOpenChunk: vi.fn() });

      controller.scrollBlockIntoView("first");
      controller.scrollBlockIntoView("second");

      expect(first.classList.contains("is-highlighted")).toBe(false);
      expect(second.classList.contains("is-highlighted")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
