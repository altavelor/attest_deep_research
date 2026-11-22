// @vitest-environment happy-dom

import { afterEach, beforeEach, expect, it } from "vitest";
import { App, Component } from "obsidian";

import { createTranslator } from "@adapters/i18n";
import { renderAssistantMessageContent } from "@apps/obsidian/ui/chat/assistantMessageRenderer";
import type { ChatTranscriptOptions } from "@apps/obsidian/ui/chat/ChatTranscript";
import type { ChatDisplayMessage } from "@core/conversation";
import { settle } from "../../support/async";
import { createContainer, installObsidianDomHelpers, resetDom } from "../../support/domHarness";

const t = createTranslator("en").t;

const renderOptions = {
  t,
  app: new App(),
  markdownContext: new Component(),
  isDebugMode: true,
  onOpenToolOutput: () => {},
} as unknown as ChatTranscriptOptions;

const message: ChatDisplayMessage = {
  role: "assistant",
  content: "Answer with a fence:\n\n```\nS = L × B\n```",
  createdAt: "2026-01-01T00:00:00.000Z",
  researchProgress: {
    phase: "complete",
    mode: "thinking",
    disclosure: "auto",
    view: "expanded",
    reasoning: { phase: "complete", segments: [] },
    checkpoints: [],
    chain: [
      { kind: "reasoning", segmentId: "long", content: "one\ntwo\nthree\nfour\nfive" },
      { kind: "checkpoint", id: "c1", round: 1, content: "Narration", status: "complete" },
      {
        kind: "tool-call",
        id: "note",
        name: "create_note",
        label: "Create note",
        status: "complete",
        args: { path: "A.md", content: "Note body" },
      },
      { kind: "reasoning", segmentId: "short", content: "Done" },
    ],
  },
};

beforeEach(installObsidianDomHelpers);
afterEach(resetDom);

it("renders every chat markdown target with Obsidian reading-view styling", async () => {
  const container = createContainer();

  renderAssistantMessageContent(container, message, renderOptions);
  await settle();

  const sources = [
    message.content,
    "one\ntwo\nthree\nfour\nfive",
    "Narration",
    "Note body",
    "Done",
  ];
  const targets = sources.map((source) => renderedTarget(container, source));
  for (const target of targets) expect(target?.classList).toContain("markdown-rendered");
});

function renderedTarget(container: HTMLElement, markdown: string): HTMLElement | null {
  const walker = container.ownerDocument.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.textContent === markdown) return node.parentElement;
  }
  return null;
}
