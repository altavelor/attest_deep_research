// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App, Component } from "obsidian";

import { renderWorkflowNodes } from "@apps/obsidian/ui/chat/workflowRenderer";
import {
  finalizeLastAssistantReasoning,
  nextChainToolCallStart,
  startAssistantProgress,
} from "@core/conversation";
import type { ChainItem, ChatDisplayMessage } from "@core/conversation";
import type { ResearchMode } from "@core/research";
import {
  advanceTime,
  createContainer,
  resetDom,
  restoreDomTimers,
  useDomFakeTimers,
} from "../../helpers/domHarness";

function streaming(
  chain: ChainItem[],
  finalizing = false,
  mode?: ResearchMode,
): ChatDisplayMessage {
  return {
    role: "assistant",
    content: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    researchProgress: {
      phase: "streaming",
      ...(mode ? { mode } : {}),
      disclosure: "auto",
      view: "expanded",
      reasoning: { phase: "streaming", segments: [] },
      checkpoints: finalizing
        ? [{ id: "c1", round: 1, content: "Wrapping up", status: "finalizing" }]
        : [],
      chain,
    },
  };
}

function lastMessage(messages: ChatDisplayMessage[]): ChatDisplayMessage {
  const message = messages.at(-1);
  if (!message) throw new Error("The reducer produced no assistant message.");
  return message;
}

function render(host: HTMLElement, message: ChatDisplayMessage): boolean {
  return renderWorkflowNodes(host, message, {
    app: new App(),
    markdownContext: new Component(),
    isDebugMode: false,
    onOpenToolOutput: () => {},
  });
}

function dotOf(host: HTMLElement, nodeSelector: string): HTMLElement {
  const node = host.querySelector<HTMLElement>(nodeSelector);
  if (!node) throw new Error(`No workflow node matched ${nodeSelector}.`);
  const dot = node.firstElementChild;
  if (!(dot instanceof HTMLElement)) throw new Error(`${nodeSelector} rendered no leading dot.`);
  return dot;
}

const searchCall: ChainItem = {
  kind: "tool-call",
  id: "search",
  name: "search_web",
  label: "Search the web",
  status: "complete",
  args: { query: "obsidian" },
  resultJson: JSON.stringify({
    value: {
      results: [
        { resultId: "r1", url: "https://alpha.example/a" },
        { resultId: "r2", url: "https://beta.example/b" },
      ],
    },
  }),
};

const pendingFetch: ChainItem = {
  kind: "tool-call",
  id: "fetch",
  name: "fetch_web_page",
  label: "Read pages",
  status: "pending",
  args: { resultIds: ["r1", "r2"] },
};

let container: HTMLElement;

beforeEach(() => {
  useDomFakeTimers();
  container = createContainer();
  container.classList.add("ixplorer-chat__transcript");
});

afterEach(() => {
  restoreDomTimers();
  resetDom();
});

describe("workflow node dots", () => {
  it("marks the reasoning node dot as thinking", () => {
    expect(
      render(container, streaming([{ kind: "reasoning", segmentId: "s1", content: "Planning" }])),
    ).toBe(true);

    const dot = dotOf(container, ".ixplorer-chat__workflow-node--thinking");
    expect(dot.classList.contains("ixplorer-chat__workflow-dot")).toBe(true);
    expect(dot.classList.contains("ixplorer-chat__workflow-dot--thinking")).toBe(true);
    expect(dot.classList.contains("ixplorer-chat__workflow-dot--tool")).toBe(false);
  });

  it("marks the tool node dot as tool", () => {
    render(container, streaming([searchCall]));

    const dot = dotOf(container, ".ixplorer-chat__workflow-node--tool");
    expect(dot.classList.contains("ixplorer-chat__workflow-dot")).toBe(true);
    expect(dot.classList.contains("ixplorer-chat__workflow-dot--tool")).toBe(true);
    expect(dot.classList.contains("ixplorer-chat__workflow-dot--thinking")).toBe(false);
  });

  it("marks the finalizing indicator dot as finalizing", () => {
    render(container, streaming([searchCall], true));

    const node = container.querySelector<HTMLElement>(".ixplorer-chat__workflow-node--finalizing");
    expect(node?.classList.contains("ixplorer-chat__workflow-node--thinking-active")).toBe(true);
    expect(node?.textContent).toContain("Finalizing…");
    const dot = dotOf(container, ".ixplorer-chat__workflow-node--finalizing");
    expect(dot.classList.contains("ixplorer-chat__workflow-dot--finalizing")).toBe(true);
    expect(dot.classList.contains("ixplorer-chat__workflow-dot--thinking")).toBe(false);
  });

  it("keeps the workflow list as the root of the rendered nodes", () => {
    render(container, streaming([searchCall]));

    const list = container.querySelector<HTMLElement>(".ixplorer-chat__workflow");
    expect(list?.parentElement).toBe(container);
    expect(list?.querySelector(".ixplorer-chat__workflow-node--tool")).not.toBeNull();
  });
});

describe("early workflow indicator per research mode", () => {
  function startedIn(mode: ResearchMode): ChatDisplayMessage {
    return lastMessage(startAssistantProgress([], mode));
  }

  it("renders no workflow block while an Instant run streams", () => {
    expect(render(container, startedIn("instant"))).toBe(false);

    expect(container.querySelector(".ixplorer-chat__workflow")).toBeNull();
    expect(container.textContent).not.toContain("Thinking…");
  });

  it("renders no workflow block once an Instant run completes", () => {
    const completed = lastMessage(
      finalizeLastAssistantReasoning(startAssistantProgress([], "instant")),
    );

    expect(completed.researchProgress?.phase).toBe("complete");
    expect(render(container, completed)).toBe(false);
    expect(container.textContent).not.toContain("Thinking…");
  });

  it("shows the Thinking indicator before the first event of a Thinking run", () => {
    expect(render(container, startedIn("thinking"))).toBe(true);

    expect(
      container.querySelector(".ixplorer-chat__workflow-node--thinking-active"),
    ).not.toBeNull();
    expect(container.textContent).toContain("Thinking…");
  });

  it("shows the Thinking indicator before the first event of a Deep Research run", () => {
    expect(render(container, startedIn("deep-research"))).toBe(true);
    expect(container.textContent).toContain("Thinking…");
  });

  it("shows the Thinking indicator for chats saved before the mode was recorded", () => {
    expect(render(container, streaming([]))).toBe(true);
    expect(container.textContent).toContain("Thinking…");
  });

  it("keeps the Finalizing indicator of a Thinking run that produced chain nodes", () => {
    expect(render(container, streaming([searchCall], true, "thinking"))).toBe(true);
    expect(container.querySelector(".ixplorer-chat__workflow-node--finalizing")).not.toBeNull();
  });

  it("keeps the Finalizing indicator of a Thinking run without chain nodes", () => {
    expect(render(container, streaming([], true, "thinking"))).toBe(true);
    expect(container.querySelector(".ixplorer-chat__workflow-node--finalizing")).not.toBeNull();
  });

  it("keeps nodes and indicator when a Thinking run falls back to Instant", () => {
    const fallback = lastMessage(
      nextChainToolCallStart(
        startAssistantProgress([], "thinking"),
        "search",
        "search_web",
        "Search the web",
      ),
    );

    expect(render(container, fallback)).toBe(true);
    expect(container.querySelector(".ixplorer-chat__workflow-node--tool")).not.toBeNull();
    expect(container.textContent).toContain("Thinking…");
  });
});

describe("demoted checkpoint nodes", () => {
  it("renders a chain checkpoint as a summary node", () => {
    const message = streaming([
      { kind: "checkpoint", id: "c1", round: 1, content: "Narration", status: "complete" },
    ]);

    expect(render(container, message)).toBe(true);
    const node = container.querySelector<HTMLElement>(".ixplorer-chat__workflow-node--summary");
    expect(node).not.toBeNull();
  });
});

describe("fetch targets of a pending fetch", () => {
  it("puts the active modifier on a single fetch-target item inside the target list", async () => {
    render(container, streaming([searchCall, pendingFetch]));

    const list = container.querySelector<HTMLElement>(".ixplorer-chat__tool-fetch-targets");
    const items = Array.from(
      list?.querySelectorAll<HTMLElement>(".ixplorer-chat__tool-fetch-target") ?? [],
    );
    expect(items).toHaveLength(2);

    const active = Array.from(
      container.querySelectorAll<HTMLElement>(".ixplorer-chat__tool-fetch-target--active"),
    );
    expect(active).toEqual([items[0]]);

    await advanceTime(1_000);
    expect(
      Array.from(container.querySelectorAll(".ixplorer-chat__tool-fetch-target--active")),
    ).toEqual([items[1]]);
  });
});
