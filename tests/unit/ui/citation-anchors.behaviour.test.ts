// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, Component, MarkdownRenderer } from "obsidian";

import {
  patchAssistantMessageContent,
  renderAssistantMessageContent,
} from "@apps/obsidian/ui/chat/assistantMessageRenderer";
import type { ChatDisplayMessage } from "@core/conversation";
import type { RetrievedChunk } from "@core/model";
import { renderInlineCitationAnchors } from "@apps/obsidian/ui/chat/citationAnchorRenderer";
import {
  buildCitationRefs,
  renderCitationBlocks,
} from "@apps/obsidian/ui/chat/citations/CitationPopover";
import { citationEvidence } from "@apps/obsidian/ui/chat/citations/citationEvidence";
import type { ChatTranscriptOptions } from "@apps/obsidian/ui/chat/ChatTranscript";
import { createTranslator } from "@adapters/i18n";
import { createContainer, resetDom } from "../../helpers/domHarness";

const t = createTranslator("en").t;

const EVIDENCE_ID = "web-hash-openai";

function webChunk(id: string, url: string, text: string): RetrievedChunk {
  return {
    id,
    text,
    score: 1,
    contentHash: id,
    source: {
      id,
      kind: "web",
      title: url,
      url,
      snippet: "",
      retrievedAt: "2026-01-01T00:00:00.000Z",
      wasContentFetched: true,
    },
  };
}

function message(overrides: Partial<ChatDisplayMessage> = {}): ChatDisplayMessage {
  const chunk = webChunk(EVIDENCE_ID, "https://openai.com/pricing", "GPT-4o costs $2.50 per 1M.");
  return {
    role: "assistant",
    content: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    evidence: [chunk],
    answer: {
      question: "How much?",
      answer: "",
      citations: [{ id: EVIDENCE_ID, label: "Pricing", source: chunk.source }],
      followUpQuestions: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    ...overrides,
  };
}

const transcriptOptions = {
  t,
  onOpenCitationPopover: () => {},
  onScheduleCitationPopoverClose: () => {},
  onScrollCitationBlockIntoView: () => {},
} as unknown as ChatTranscriptOptions;

const renderOptions = {
  ...transcriptOptions,
  app: new App(),
  markdownContext: new Component(),
  isDebugMode: false,
  onOpenToolOutput: () => {},
  onSaveAnswerToNewNote: () => {},
  onAppendAnswerToActiveNote: () => {},
} as unknown as ChatTranscriptOptions;

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

let container: HTMLElement;

beforeEach(() => {
  container = createContainer();
});

afterEach(() => {
  resetDom();
});

describe("inline citation anchors", () => {
  it("creates replacement nodes in the rendered container's popout document", () => {
    const popoutDocument = document.implementation.createHTMLDocument("Popout");
    const popoutContainer = popoutDocument.body.createDiv();
    popoutContainer.createEl("p", { text: `Claim [${EVIDENCE_ID}].` });
    const globalWalker = vi.spyOn(document, "createTreeWalker").mockImplementation(() => {
      throw new Error("global document used");
    });

    try {
      renderInlineCitationAnchors(
        popoutContainer,
        buildCitationRefs(citationEvidence(message())),
        transcriptOptions,
      );
    } finally {
      globalWalker.mockRestore();
    }

    const anchor = popoutContainer.querySelector(".attest-chat__citation-anchor");
    expect(anchor?.ownerDocument).toBe(popoutDocument);
    expect(popoutContainer.querySelector("p")?.textContent).toBe("Claim [1].");
  });

  it("renders one anchor per resolved token and appends no fallback block", () => {
    container.createEl("p", { text: `GPT-4o costs $2.50 per 1M [${EVIDENCE_ID}].` });

    renderInlineCitationAnchors(
      container,
      buildCitationRefs(citationEvidence(message())),
      transcriptOptions,
    );

    const anchors = container.querySelectorAll(".attest-chat__citation-anchor");
    expect(anchors).toHaveLength(1);
    expect(anchors[0].textContent).toBe("[1]");
    expect(container.querySelector("p")?.textContent).toBe("GPT-4o costs $2.50 per 1M [1].");
  });

  it("opens the targeted registry revision when a bound inline citation is clicked", () => {
    const revisionId = "source-1:revision-1";
    const openRevision = vi.fn();
    container.createEl("p", { text: `Claim [${revisionId}].` });
    renderInlineCitationAnchors(
      container,
      buildCitationRefs([webChunk(revisionId, "https://example.com", "Claim evidence")]),
      { ...transcriptOptions, onOpenRegistryRevision: openRevision },
    );

    container.querySelector<HTMLButtonElement>(".attest-chat__citation-anchor")?.click();
    expect(openRevision).toHaveBeenCalledWith(revisionId);
  });

  it("linkifies url handles while streaming but leaves the final answer text alone", async () => {
    const streaming: ChatDisplayMessage = {
      role: "assistant",
      content: "Draft [url:https://example.com/unseen]",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const finalized = message({
      content: "Final [url:https://example.com/unseen]",
      evidence: [],
      answer: { ...message().answer!, citations: [] },
    });

    renderAssistantMessageContent(container, streaming, renderOptions);
    renderAssistantMessageContent(container, finalized, renderOptions);
    await settle();

    const answers = container.querySelectorAll(".attest-chat__answer-content");
    expect(answers[0].textContent).toContain("[unseen — example.com](https://example.com/unseen)");
    expect(answers[1].textContent).not.toContain("](https://example.com/unseen)");
  });

  it("still appends fallback anchors when no token resolved", () => {
    container.createEl("p", { text: "GPT-4o costs $2.50 per 1M." });

    renderInlineCitationAnchors(
      container,
      buildCitationRefs(citationEvidence(message())),
      transcriptOptions,
    );

    expect(container.querySelectorAll(".attest-chat__citation-anchor")).toHaveLength(1);
  });
});

describe("web references without evidence", () => {
  const withWebReference = message({
    answer: {
      ...message().answer!,
      webReferences: [{ id: "web-ref-1", url: "https://example.com/unseen" }],
    },
  });

  it("numbers a link-only source after the cited evidence and anchors it inline", () => {
    container.createEl("p", { text: `Claim [${EVIDENCE_ID}] and [web-ref-1] follow.` });

    renderInlineCitationAnchors(
      container,
      buildCitationRefs(citationEvidence(withWebReference)),
      transcriptOptions,
    );

    expect(
      Array.from(container.querySelectorAll(".attest-chat__citation-anchor")).map(
        (anchor) => anchor.textContent,
      ),
    ).toEqual(["[1]", "[2]"]);
  });

  it("renders its source card as a bare link, without an excerpt or a copy button", () => {
    renderCitationBlocks(container, buildCitationRefs(citationEvidence(withWebReference)), {
      t,
      onOpenChunk: () => {},
      onHighlight: () => {},
    });

    const blocks = container.querySelectorAll<HTMLElement>(".attest-chat__citation-block");
    expect(blocks).toHaveLength(2);
    const linkOnly = blocks[1];
    expect(linkOnly.textContent).toContain("https://example.com/unseen");
    expect(linkOnly.querySelector(".attest-chat__citation-block-text")).toBeNull();
    expect(linkOnly.querySelector(".attest-chat__citation-copy")).toBeNull();
    expect(blocks[0].querySelector(".attest-chat__citation-block-text")?.textContent).toContain(
      "GPT-4o costs",
    );
  });
});

describe("answer status dot", () => {
  // The stub renderer replaces the container's content, which would drop the
  // header; Obsidian appends into it, so the spy reproduces that.
  beforeEach(() => {
    vi.spyOn(MarkdownRenderer, "render").mockImplementation(
      async (_app, markdown: string, element: HTMLElement) => {
        element.appendChild(document.createTextNode(markdown));
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function assistant(mode: "instant" | "thinking"): ChatDisplayMessage {
    return {
      ...message({ content: "The answer." }),
      researchProgress: {
        phase: "complete",
        mode,
        disclosure: "auto",
        view: "expanded",
        reasoning: { phase: "complete", segments: [] },
        checkpoints: [],
        chain:
          mode === "instant" ? [] : [{ kind: "reasoning", segmentId: "s1", content: "Planning" }],
      },
    };
  }

  it("omits the timeline dot for an Instant run and keeps it for a Thinking run", () => {
    renderAssistantMessageContent(container, assistant("instant"), renderOptions);
    expect(container.querySelector(".attest-chat__answer-status-dot")).toBeNull();
    expect(container.querySelector(".attest-chat__workflow")).toBeNull();

    const thinkingHost = createContainer();
    renderAssistantMessageContent(thinkingHost, assistant("thinking"), renderOptions);
    expect(thinkingHost.querySelector(".attest-chat__answer-status-dot")).not.toBeNull();
  });

  it("omits the dot on the patched render path too", () => {
    renderAssistantMessageContent(container, assistant("thinking"), renderOptions);
    expect(container.querySelector(".attest-chat__answer-status-dot")).not.toBeNull();

    expect(patchAssistantMessageContent(container, assistant("instant"), renderOptions)).toBe(true);
    expect(container.querySelector(".attest-chat__answer-status-dot")).toBeNull();
  });

  it("renders the finalized canonical citation text without another density pass", () => {
    const finalized = message({
      content: `First claim [${EVIDENCE_ID}]. Second claim.`,
    });

    renderAssistantMessageContent(container, finalized, renderOptions);

    expect(MarkdownRenderer.render).toHaveBeenCalledWith(
      renderOptions.app,
      `First claim [${EVIDENCE_ID}]. Second claim.`,
      expect.any(HTMLElement),
      "",
      renderOptions.markdownContext,
    );
  });

  it("preserves a Markdown reference link whose text matches a known citation id", () => {
    const markdown = [
      `Read [${EVIDENCE_ID}][${EVIDENCE_ID}].`,
      "",
      `[${EVIDENCE_ID}]: https://openai.com/pricing`,
    ].join("\n");

    renderAssistantMessageContent(container, message({ content: markdown }), renderOptions);

    expect(MarkdownRenderer.render).toHaveBeenCalledWith(
      renderOptions.app,
      markdown,
      expect.any(HTMLElement),
      "",
      renderOptions.markdownContext,
    );
  });
});
