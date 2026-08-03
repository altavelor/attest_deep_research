// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  IndexSearchController,
  type IndexSearchControllerContext,
  type IndexSearchResult,
} from "@apps/obsidian/ui/index/IndexSearchController";
import type { IndexProfileSelectOption } from "@apps/obsidian/ui/chat/ChatComposer";
import type { RetrievedChunk } from "@core/model";
import { createContainer, resetDom } from "../../helpers/domHarness";
import { markdownSource, retrieved } from "../../helpers/factories";

const profiles: IndexProfileSelectOption[] = [
  { id: "ready", name: "Ready", isIndexed: true },
  { id: "degraded", name: "Degraded", isIndexed: true },
];

const chunk: RetrievedChunk = retrieved(
  "c1",
  markdownSource("notes/found.md"),
  "matched text",
  0.9,
);

function createController(overrides: Partial<IndexSearchControllerContext> = {}) {
  const searchIndex = vi.fn<[unknown], Promise<IndexSearchResult>>(async () => ({
    chunks: [chunk],
  }));
  const ctx: IndexSearchControllerContext = {
    getIndexProfiles: () => profiles,
    getSelectedIndexProfileId: () => "ready",
    getEmbedderWarning: () => undefined,
    searchIndex,
    onOpenChunk: () => {},
    ...overrides,
  };
  return { controller: new IndexSearchController(ctx), searchIndex };
}

function panelRefs(host: HTMLElement) {
  const form = host.querySelector<HTMLFormElement>("form");
  const profile = host.querySelector<HTMLSelectElement>("select");
  const query = host.querySelector<HTMLTextAreaElement>("textarea");
  const button = host.querySelector<HTMLButtonElement>(".ixplorer-index-search__button");
  if (!form || !profile || !query || !button) {
    throw new Error("The index-search panel did not render its controls.");
  }
  return {
    form,
    profile,
    query,
    button,
    submit: () => form.dispatchEvent(new Event("submit", { cancelable: true })),
  };
}

function warningText(host: HTMLElement): string | null {
  const warning = host.querySelector('[role="alert"]');
  return warning ? warning.textContent : null;
}

let container: HTMLElement;

beforeEach(() => {
  container = createContainer();
});

afterEach(() => {
  resetDom();
});

describe("index search panel warnings", () => {
  it("blocks the search and warns for the profile the host selected", () => {
    const { controller } = createController({
      getEmbedderWarning: (id) => (id === "ready" ? "Embedder is missing." : undefined),
    });

    controller.render(container);

    expect(warningText(container)).toBe("Embedder is missing.");
    expect(panelRefs(container).button.disabled).toBe(true);
  });

  it("keeps the search available when the selected profile has no warning", () => {
    const { controller } = createController({
      getEmbedderWarning: (id) => (id === "degraded" ? "Embedder is missing." : undefined),
    });

    controller.render(container);

    expect(warningText(container)).toBeNull();
    expect(panelRefs(container).button.disabled).toBe(false);
  });

  it("preflights the host-configured profile rather than the first one", () => {
    const { controller } = createController({
      getSelectedIndexProfileId: () => "degraded",
      getEmbedderWarning: (id) => (id === "degraded" ? "Embedder is missing." : undefined),
    });

    controller.render(container);

    const refs = panelRefs(container);
    expect(refs.profile.value).toBe("degraded");
    expect(warningText(container)).toBe("Embedder is missing.");
    expect(refs.button.disabled).toBe(true);
  });

  it("reports a keyword-only fallback returned by the search", async () => {
    const { controller } = createController({
      searchIndex: async () => ({ chunks: [chunk], semanticError: "embedding endpoint down" }),
    });
    controller.render(container);
    const refs = panelRefs(container);
    refs.query.value = "matched";

    refs.submit();
    await vi.waitFor(() => {
      if (!warningText(container)) throw new Error("No fallback warning yet.");
    });

    expect(warningText(container)).toContain("keyword-only ranking");
    expect(container.textContent).toContain("notes/found.md");
  });

  it("clears the fallback warning when another profile is selected", async () => {
    const { controller } = createController({
      searchIndex: async () => ({ chunks: [chunk], semanticError: "embedding endpoint down" }),
    });
    controller.render(container);
    const refs = panelRefs(container);
    refs.query.value = "matched";
    refs.submit();
    await vi.waitFor(() => {
      if (!warningText(container)) throw new Error("No fallback warning yet.");
    });

    const liveRefs = panelRefs(container);
    liveRefs.profile.value = "degraded";
    liveRefs.profile.dispatchEvent(new Event("change"));

    expect(warningText(container)).toBeNull();
  });

  it("does not search an empty query", () => {
    const { controller, searchIndex } = createController();
    controller.render(container);

    panelRefs(container).submit();

    expect(searchIndex).not.toHaveBeenCalled();
  });
});
