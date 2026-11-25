// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, Component } from "obsidian";

import { createTranslator } from "@adapters/i18n";
import { renderWorkflowTimeline, WorkflowTimelineHandle } from "@apps/obsidian/ui/chat/workflow";
import type { ChainItem } from "@core/conversation";
import { createContainer, installObsidianDomHelpers, resetDom } from "../support/domHarness";

const t = createTranslator("en").t;
const handles: WorkflowTimelineHandle[] = [];

function renderTool(
  list: HTMLElement,
  item: ChainItem,
  onOpenToolOutput: (item: ChainItem) => void,
  isDebugMode = true,
): void {
  const handle = renderWorkflowTimeline(
    list,
    {
      scopeId: "message-1",
      items: [item],
      phase: "complete",
      reasoningSegments: [],
      checkpoints: [],
    },
    { t, isDebugMode, onOpenToolOutput, app: new App(), markdownContext: new Component() },
  );
  handles.push(handle);
}

describe("tool workflow node renderer", () => {
  beforeEach(installObsidianDomHelpers);
  afterEach(() => {
    handles.splice(0).forEach((handle) => handle.dispose());
    resetDom();
  });

  it("renders pending fetch targets, phase, badge, debug payloads, and nested calls", () => {
    const list = createContainer();
    const onOpenToolOutput = vi.fn();
    renderTool(
      list,
      {
        kind: "tool-call",
        id: "fetch",
        name: "fetch_web_page",
        label: "Fetching pages",
        status: "pending",
        phase: "downloading",
        args: { resultIds: ["a"] },
        fetchTargets: ["docs.example.com"],
        children: [
          {
            kind: "tool-call",
            id: "child",
            name: "search_index",
            label: "Search",
            status: "complete",
            resultJson: JSON.stringify({ diagnostics: { usedKeywordFallback: true } }),
          },
        ],
      },
      onOpenToolOutput,
    );

    expect(list.querySelector(".attest-chat__tool-fetch-target--active")?.textContent).toBe(
      "docs.example.com",
    );
    expect(list.textContent).toContain("downloading");
    expect(list.querySelectorAll(".attest-chat__tool-cell")).toHaveLength(2);
    expect(list.querySelector(".attest-chat__workflow--nested")).not.toBeNull();
    expect(list.querySelector(".attest-chat__tool-badge")?.textContent).toBe("keyword-only");
    list.querySelector<HTMLElement>(".attest-chat__tool-cell")!.click();
    expect(onOpenToolOutput).toHaveBeenCalledWith(expect.objectContaining({ id: "fetch" }));
  });

  it("renders a note-edit diff and opens its full output with the keyboard", () => {
    const list = createContainer();
    const onOpenToolOutput = vi.fn();
    renderTool(
      list,
      {
        kind: "tool-call",
        id: "update",
        name: "update_note",
        label: "Update note",
        status: "complete",
        resultJson: JSON.stringify({ before: "Old line", after: "New line" }),
      },
      onOpenToolOutput,
    );

    expect(list.querySelector(".attest-chat__diff-line--remove")?.textContent).toContain(
      "Old line",
    );
    expect(list.querySelector(".attest-chat__diff-line--add")?.textContent).toContain("New line");
    const cell = list.querySelector<HTMLElement>(".attest-chat__tool-cell")!;
    cell.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(onOpenToolOutput).toHaveBeenCalledWith(expect.objectContaining({ id: "update" }));
  });

  it("shows calculation cells outside debug mode and hides other tool payloads", () => {
    const list = createContainer();
    const calculation: ChainItem = {
      kind: "tool-call",
      id: "calc",
      name: "run_js",
      label: "Calculation",
      status: "complete",
      args: { code: "1 + 1" },
      resultJson: JSON.stringify({ ok: true, computationId: "calc_1", result: 2, logs: [] }),
    };
    renderTool(list, calculation, vi.fn(), false);
    renderTool(list, { ...calculation, id: "search", name: "search_index" }, vi.fn(), false);

    expect(
      [...list.querySelectorAll(".attest-chat__tool-cell-code")].map((cell) => cell.textContent),
    ).toEqual(["1 + 1", "2"]);
  });
});
