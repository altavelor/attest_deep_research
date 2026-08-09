// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, Component } from "obsidian";

import { AdvancedSettingsSection } from "@apps/obsidian/ui/settings/AdvancedSettingsSection";
import { createTranslator } from "@adapters/i18n";
import { renderWorkflowNodes } from "@apps/obsidian/ui/chat/workflowRenderer";
import type { ChatDisplayMessage } from "@core/conversation";
import { createContainer, resetDom } from "../../helpers/domHarness";

const t = createTranslator("en").t;

function assistantWithToolCall(): ChatDisplayMessage {
  return {
    role: "assistant",
    content: "Answer",
    createdAt: "2026-01-01T00:00:00.000Z",
    researchProgress: {
      phase: "complete",
      disclosure: "auto",
      view: "expanded",
      reasoning: { phase: "complete", segments: [] },
      checkpoints: [],
      chain: [
        {
          kind: "tool-call",
          id: "t1",
          name: "search_index",
          label: "Search",
          status: "complete",
          args: { query: "vault notes", limit: 4242 },
          resultJson: JSON.stringify({ hits: ["private result"] }),
        },
      ],
    },
  };
}

function renderWorkflow(host: HTMLElement, isDebugMode: boolean): boolean {
  return renderWorkflowNodes(host, assistantWithToolCall(), {
    app: new App(),
    markdownContext: new Component(),
    isDebugMode,
    t,
    onOpenToolOutput: () => {},
  });
}

let container: HTMLElement;

beforeEach(() => {
  container = createContainer();
});

afterEach(() => {
  resetDom();
});

describe("debug-mode gating of the workflow transcript", () => {
  it("hides tool input and output cells outside debug mode", () => {
    expect(renderWorkflow(container, false)).toBe(true);

    expect(container.querySelectorAll(".ixplorer-chat__tool-cell")).toHaveLength(0);
    expect(container.textContent).not.toContain("private result");
    expect(container.textContent).not.toContain("hits");
  });

  it("keeps the tool-call header visible in both modes", () => {
    renderWorkflow(container, false);
    const withoutDebug = container.querySelector(".ixplorer-chat__tool-name")?.textContent;

    container.innerHTML = "";
    renderWorkflow(container, true);

    expect(withoutDebug).toBeTruthy();
    expect(container.querySelector(".ixplorer-chat__tool-name")?.textContent).toBe(withoutDebug);
  });

  it("shows In and Out cells in debug mode", () => {
    renderWorkflow(container, true);

    const labels = Array.from(
      container.querySelectorAll(".ixplorer-chat__tool-cell-label"),
      (el) => el.textContent,
    );
    expect(labels).toEqual(["In", "Out"]);
    expect(container.textContent).toContain("private result");
  });

  it("opens the full tool output from a debug cell with the keyboard", () => {
    const onOpenToolOutput = vi.fn();
    renderWorkflowNodes(container, assistantWithToolCall(), {
      app: new App(),
      markdownContext: new Component(),
      isDebugMode: true,
      t,
      onOpenToolOutput,
    });

    const cell = container.querySelector<HTMLElement>(".ixplorer-chat__tool-cell");
    expect(cell?.getAttribute("tabindex")).toBe("0");
    cell?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(onOpenToolOutput).toHaveBeenCalledTimes(1);
  });
});

describe("debug-mode toggle in advanced settings", () => {
  function renderToggle(initial: boolean) {
    const state = { debugMode: initial };
    const saveSettings = vi.fn(async () => {});
    const refreshChatViews = vi.fn();
    new AdvancedSettingsSection({
      t,
      isDebugMode: () => state.debugMode,
      setDebugMode: (value) => {
        state.debugMode = value;
      },
      saveSettings,
      refreshChatViews,
    }).render(container);
    const toggle = container.querySelector<HTMLInputElement>("input[type=checkbox]");
    return { state, saveSettings, refreshChatViews, toggle };
  }

  it("reflects the persisted value", () => {
    expect(renderToggle(true).toggle?.checked).toBe(true);
    container.innerHTML = "";
    expect(renderToggle(false).toggle?.checked).toBe(false);
  });

  it("persists the change and redisplays open chat views", async () => {
    const { state, saveSettings, refreshChatViews, toggle } = renderToggle(false);

    toggle?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(state.debugMode).toBe(true);
    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(refreshChatViews).toHaveBeenCalledTimes(1);
    expect(saveSettings.mock.invocationCallOrder[0]).toBeLessThan(
      refreshChatViews.mock.invocationCallOrder[0]!,
    );
  });

  it("keeps the advanced block collapsed by default", () => {
    renderToggle(false);
    const details = container.querySelector<HTMLDetailsElement>("details");

    expect(details?.open).toBe(false);
    expect(details?.querySelector("summary")?.textContent).toBe("Advanced");
  });
});
