// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App, Component } from "obsidian";

import { disposeChatTranscript } from "@apps/obsidian/ui/chat/ChatTranscript";
import { renderWorkflowNodes } from "@apps/obsidian/ui/chat/workflowRenderer";
import type { ChainItem, ChatDisplayMessage } from "@core/conversation";
import {
  advanceTime,
  createContainer,
  pendingTimerCount,
  resetDom,
  restoreDomTimers,
  useDomFakeTimers,
} from "../../helpers/domHarness";

const searchResults: ChainItem = {
  kind: "tool-call",
  id: "search",
  name: "search_web",
  label: "Search the web",
  status: "complete",
  args: { query: "obsidian plugins" },
  resultJson: JSON.stringify({
    value: {
      results: [
        { resultId: "r1", url: "https://alpha.example/a" },
        { resultId: "r2", url: "https://beta.example/b" },
        { resultId: "r3", url: "https://gamma.example/c" },
      ],
    },
  }),
};

function pendingFetch(): ChainItem {
  return {
    kind: "tool-call",
    id: "fetch",
    name: "fetch_web_page",
    label: "Read pages",
    status: "pending",
    args: { resultIds: ["r1", "r2", "r3"] },
  };
}

function messageWithPendingFetch(): ChatDisplayMessage {
  return {
    role: "assistant",
    content: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    researchProgress: {
      phase: "streaming",
      disclosure: "auto",
      view: "expanded",
      reasoning: { phase: "complete", segments: [] },
      checkpoints: [],
      chain: [searchResults, pendingFetch()],
    },
  };
}

function renderTranscript(host: HTMLElement): void {
  renderWorkflowNodes(host, messageWithPendingFetch(), {
    app: new App(),
    markdownContext: new Component(),
    isDebugMode: false,
    onOpenToolOutput: () => {},
  });
}

function activeTargets(host: HTMLElement): string[] {
  return Array.from(
    host.querySelectorAll(".ixplorer-chat__tool-fetch-target--active"),
    (el) => el.textContent ?? "",
  );
}

let transcript: HTMLElement;

beforeEach(() => {
  useDomFakeTimers();
  transcript = createContainer();
  transcript.classList.add("ixplorer-chat__transcript");
});

afterEach(() => {
  restoreDomTimers();
  resetDom();
});

describe("fetch-target animation in a pending web fetch", () => {
  it("highlights one target at a time and cycles through the list", async () => {
    renderTranscript(transcript);

    const targets = Array.from(
      transcript.querySelectorAll(".ixplorer-chat__tool-fetch-target"),
      (el) => el.textContent ?? "",
    );
    expect(targets).toEqual(["alpha.example", "beta.example", "gamma.example"]);
    expect(activeTargets(transcript)).toEqual(["alpha.example"]);

    await advanceTime(1_000);
    expect(activeTargets(transcript)).toEqual(["beta.example"]);

    await advanceTime(1_000);
    expect(activeTargets(transcript)).toEqual(["gamma.example"]);

    await advanceTime(1_000);
    expect(activeTargets(transcript)).toEqual(["alpha.example"]);
  });

  it("does not animate a completed fetch", async () => {
    const completed = messageWithPendingFetch();
    const chain = completed.researchProgress?.chain ?? [];
    const fetchItem = chain[1];
    if (fetchItem?.kind === "tool-call") fetchItem.status = "complete";
    renderWorkflowNodes(transcript, completed, {
      app: new App(),
      markdownContext: new Component(),
      isDebugMode: false,
      onOpenToolOutput: () => {},
    });

    expect(transcript.querySelectorAll(".ixplorer-chat__tool-fetch-target")).toHaveLength(0);
    expect(pendingTimerCount()).toBe(0);
    await advanceTime(5_000);
    expect(activeTargets(transcript)).toEqual([]);
  });

  it("cancels the pending frame when disposeChatTranscript releases the transcript", async () => {
    renderTranscript(transcript);
    await advanceTime(1_000);
    expect(pendingTimerCount()).toBe(1);

    disposeChatTranscript(transcript);

    expect(pendingTimerCount()).toBe(0);
    await advanceTime(10_000);
    expect(activeTargets(transcript)).toEqual(["beta.example"]);
  });

  it("stops the animation of a rerendered transcript instead of leaking a second one", async () => {
    renderTranscript(transcript);
    await advanceTime(1_000);

    disposeChatTranscript(transcript);
    transcript.empty();
    renderTranscript(transcript);

    expect(pendingTimerCount()).toBe(1);

    await advanceTime(1_000);
    expect(activeTargets(transcript)).toEqual(["beta.example"]);
  });
});
