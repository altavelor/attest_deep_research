// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../stubs/obsidian";
import type { App as ObsidianApp } from "obsidian";

import { createTranslator } from "@adapters/i18n";
import {
  CHAT_SOURCE_RENDER_BATCH,
  CHAT_SOURCE_USAGE_RENDER_BATCH,
  ChatSourcesModal,
  MAX_CHAT_SOURCE_SEARCH_CHARS_PER_REVISION,
  buildBoundedSearchText,
  buildChatSourceSearchProjection,
} from "@apps/obsidian/ui/chat/sources/ChatSourcesModal";
import type { ConversationSourceRegistry } from "@core/chat/sourceRegistry";
import { installObsidianDomHelpers, resetDom } from "../../helpers/domHarness";

const registry: ConversationSourceRegistry = {
  sources: [
    {
      id: "source-1",
      identity: { kind: "web", canonicalKey: "https://example.com/alpha" },
      title: "Alpha source",
      revisions: [
        {
          id: "source-1:revision-1",
          contentHash: "hash",
          capturedAt: "2026-08-21T00:00:00.000Z",
          status: "active",
          usages: [{ messageId: "message-1", citationOffsets: [7] }],
          chunks: [
            {
              id: "chunk-1",
              text: "Distinctive astronomy evidence",
              contentHash: "hash",
              score: 1,
              source: {
                id: "web-1",
                kind: "web",
                title: "Alpha source",
                url: "https://example.com/alpha",
                snippet: "",
                retrievedAt: "2026-08-21T00:00:00.000Z",
                wasContentFetched: true,
              },
            },
          ],
        },
      ],
    },
  ],
};

beforeEach(installObsidianDomHelpers);
afterEach(() => {
  vi.useRealTimers();
  resetDom();
});

describe("ChatSourcesModal", () => {
  it("stops reading search parts as soon as the bounded projection is full", () => {
    const consumed: string[] = [];
    function* parts(): Generator<string> {
      consumed.push("first");
      yield "a".repeat(MAX_CHAT_SOURCE_SEARCH_CHARS_PER_REVISION);
      consumed.push("second");
      throw new Error("The extractor read beyond its character budget");
    }

    expect(buildBoundedSearchText(parts(), MAX_CHAT_SOURCE_SEARCH_CHARS_PER_REVISION)).toHaveLength(
      MAX_CHAT_SOURCE_SEARCH_CHARS_PER_REVISION,
    );
    expect(consumed).toEqual(["first"]);
  });

  it("indexes a later chunk when an earlier chunk is larger than the search budget", () => {
    const laterChunkRegistry: ConversationSourceRegistry = {
      sources: [
        {
          ...registry.sources[0],
          title: `Oversized title ${"t".repeat(MAX_CHAT_SOURCE_SEARCH_CHARS_PER_REVISION * 2)}`,
          identity: {
            ...registry.sources[0].identity,
            canonicalKey: `https://distinctive.example/archive/${"k".repeat(
              MAX_CHAT_SOURCE_SEARCH_CHARS_PER_REVISION * 2,
            )}`,
          },
          revisions: [
            {
              ...registry.sources[0].revisions[0],
              chunks: [
                {
                  ...registry.sources[0].revisions[0].chunks[0],
                  id: "chunk:first",
                  text: "x".repeat(MAX_CHAT_SOURCE_SEARCH_CHARS_PER_REVISION * 2),
                },
                {
                  ...registry.sources[0].revisions[0].chunks[0],
                  id: "chunk:later",
                  text: "late-needle appears here",
                },
              ],
            },
          ],
        },
      ],
    };

    const projection = buildChatSourceSearchProjection(laterChunkRegistry);

    expect(projection[0].searchText).toContain("oversized title");
    expect(projection[0].searchText).toContain("https://distinctive.example/archive/");
    expect(projection[0].searchText).toContain("source-1:revision-1");
    expect(projection[0].searchText).toContain("late-needle");
    expect(projection[0].searchText.length).toBeLessThanOrEqual(
      MAX_CHAT_SOURCE_SEARCH_CHARS_PER_REVISION,
    );

    const modal = new ChatSourcesModal(
      new App() as unknown as ObsidianApp,
      laterChunkRegistry,
      createTranslator("en").t,
      () => "ltr",
      { targetRevisionId: "source-1:revision-1", onNavigateMessage: vi.fn() },
    );
    modal.open();
    expect(
      modal.contentEl.querySelector<HTMLDetailsElement>(
        ".attest-chat-sources-modal__source > summary",
      )!.textContent!.length,
    ).toBeLessThan(200);
    expect(
      modal.contentEl.querySelector<HTMLElement>(".attest-chat-sources-modal__identity")!
        .textContent!.length,
    ).toBeLessThanOrEqual(240);
  });

  it("bounds initial projection work and cancels scheduled scans on close", () => {
    vi.useFakeTimers();
    let evidenceReads = 0;
    const largeRegistry: ConversationSourceRegistry = {
      sources: Array.from({ length: 500 }, (_, index) => {
        const chunk = {
          ...registry.sources[0].revisions[0].chunks[0],
          id: `chunk-${index}`,
        };
        Object.defineProperty(chunk, "text", {
          enumerable: true,
          get() {
            evidenceReads += 1;
            return `evidence-${index}`;
          },
        });
        return {
          ...registry.sources[0],
          id: `source-${index + 1}`,
          revisions: [
            {
              ...registry.sources[0].revisions[0],
              id: `source-${index + 1}:revision-1`,
              chunks: [chunk],
            },
          ],
        };
      }),
    };
    const modal = new ChatSourcesModal(
      new App() as unknown as ObsidianApp,
      largeRegistry,
      createTranslator("en").t,
      () => "ltr",
      { onNavigateMessage: vi.fn() },
    );

    modal.open();
    expect(evidenceReads).toBe(CHAT_SOURCE_RENDER_BATCH);
    expect(modal.contentEl.querySelectorAll("[data-revision-id]")).toHaveLength(
      CHAT_SOURCE_RENDER_BATCH,
    );

    const search = modal.contentEl.querySelector<HTMLInputElement>("input[type=search]")!;
    search.value = "absent-topic";
    search.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(150);
    const readsBeforeClose = evidenceReads;
    expect(readsBeforeClose).toBeLessThanOrEqual(CHAT_SOURCE_RENDER_BATCH * 2);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    search.value = "evidence-499";
    search.dispatchEvent(new Event("input"));
    expect(vi.getTimerCount()).toBe(1);
    modal.close();
    vi.runAllTimers();
    expect(evidenceReads).toBe(readsBeforeClose);
  });

  it("renders and searches the hierarchy, focuses a revision, and navigates to its message", () => {
    vi.useFakeTimers();
    const navigate = vi.fn();
    const modal = new ChatSourcesModal(
      new App() as unknown as ObsidianApp,
      registry,
      createTranslator("en").t,
      () => "rtl",
      { targetRevisionId: "source-1:revision-1", onNavigateMessage: navigate },
    );
    modal.open();

    expect(modal.modalEl.getAttribute("dir")).toBe("rtl");
    expect(
      modal.contentEl.querySelector<HTMLDetailsElement>('[data-revision-id="source-1:revision-1"]')
        ?.open,
    ).toBe(true);
    expect(document.activeElement?.getAttribute("data-revision-id")).toBe("source-1:revision-1");
    modal.contentEl
      .querySelector<HTMLButtonElement>(".attest-chat-sources-modal__usages button")
      ?.click();
    expect(navigate).toHaveBeenCalledWith("message-1");

    modal.open();
    const search = modal.contentEl.querySelector<HTMLInputElement>("input[type=search]")!;
    search.value = "no-match";
    search.dispatchEvent(new Event("input"));
    vi.runAllTimers();
    expect(modal.contentEl.querySelector(".attest-chat-sources-modal__source")).toBeNull();
  });

  it("bounds projection work and incrementally renders a large registry after debounced search", () => {
    vi.useFakeTimers();
    const largeRegistry: ConversationSourceRegistry = {
      sources: Array.from({ length: 125 }, (_, index) => ({
        id: `source-${index + 1}`,
        identity: { kind: "web" as const, canonicalKey: `https://example.com/${index + 1}` },
        title: `Source ${index + 1}`,
        revisions: [
          {
            id: `source-${index + 1}:revision-1`,
            contentHash: `hash-${index + 1}`,
            capturedAt: "2026-08-21T00:00:00.000Z",
            status: "active" as const,
            usages:
              index === 0
                ? Array.from({ length: 200 }, (_, usageIndex) => ({
                    messageId: `message-${usageIndex + 1}`,
                    citationOffsets: [usageIndex],
                  }))
                : [],
            chunks: [
              {
                id: `chunk-${index + 1}`,
                text: `${"bounded ".repeat(2_000)} unique-${index + 1}`,
                contentHash: `hash-${index + 1}`,
                score: 1,
                source: {
                  id: `web-${index + 1}`,
                  kind: "web" as const,
                  title: `Source ${index + 1}`,
                  url: `https://example.com/${index + 1}`,
                  snippet: "",
                  retrievedAt: "2026-08-21T00:00:00.000Z",
                  wasContentFetched: true,
                },
              },
            ],
          },
        ],
      })),
    };
    const projection = buildChatSourceSearchProjection(largeRegistry);
    expect(Math.max(...projection.map((entry) => entry.searchText.length))).toBeLessThanOrEqual(
      MAX_CHAT_SOURCE_SEARCH_CHARS_PER_REVISION,
    );

    const modal = new ChatSourcesModal(
      new App() as unknown as ObsidianApp,
      largeRegistry,
      createTranslator("en").t,
      () => "ltr",
      { targetRevisionId: "source-1:revision-1", onNavigateMessage: vi.fn() },
    );
    modal.open();
    expect(modal.contentEl.querySelectorAll("[data-revision-id]")).toHaveLength(
      CHAT_SOURCE_RENDER_BATCH,
    );
    expect(modal.contentEl.querySelector(".attest-chat-sources-modal__load-more")).not.toBeNull();
    expect(
      modal.contentEl.querySelectorAll(".attest-chat-sources-modal__usages button"),
    ).toHaveLength(CHAT_SOURCE_USAGE_RENDER_BATCH + 1);

    const search = modal.contentEl.querySelector<HTMLInputElement>("input[type=search]")!;
    search.value = "source 125";
    search.dispatchEvent(new Event("input"));
    expect(modal.contentEl.querySelectorAll("[data-revision-id]")).toHaveLength(
      CHAT_SOURCE_RENDER_BATCH,
    );
    vi.runAllTimers();
    expect(modal.contentEl.querySelectorAll("[data-revision-id]")).toHaveLength(1);
    expect(
      modal.contentEl.querySelector("[data-revision-id='source-125:revision-1']"),
    ).not.toBeNull();
  });
});
