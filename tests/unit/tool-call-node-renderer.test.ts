// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTranslator } from "@adapters/i18n";
import { renderToolNode } from "@apps/obsidian/ui/chat/workflow/toolCallNodeRenderer";
import { createContainer, installObsidianDomHelpers, resetDom } from "../helpers/domHarness";

const t = createTranslator("en").t;

describe("tool workflow node renderer", () => {
  beforeEach(installObsidianDomHelpers);
  afterEach(resetDom);

  it("renders pending fetch targets, phase, badge, debug payloads, and nested calls", () => {
    const list = createContainer();
    const onOpenToolOutput = vi.fn();
    renderToolNode(
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
      {
        t,
        isDebugMode: true,
        onOpenToolOutput,
        app: {} as never,
        markdownContext: {} as never,
      } as never,
      ["docs.example.com"],
    );

    expect(list.querySelector(".ixplorer-chat__tool-fetch-target--active")?.textContent).toBe(
      "docs.example.com",
    );
    expect(list.textContent).toContain("downloading");
    expect(list.querySelectorAll(".ixplorer-chat__tool-cell")).toHaveLength(2);
    expect(list.querySelector(".ixplorer-chat__workflow--nested")).not.toBeNull();
    expect(list.querySelector(".ixplorer-chat__tool-badge")?.textContent).toBe("keyword-only");
    list.querySelector<HTMLElement>(".ixplorer-chat__tool-cell")!.click();
    expect(onOpenToolOutput).toHaveBeenCalledWith(expect.objectContaining({ id: "fetch" }));
  });

  it("renders a note-edit diff and opens its full output with the keyboard", () => {
    const list = createContainer();
    const onOpenToolOutput = vi.fn();
    renderToolNode(
      list,
      {
        kind: "tool-call",
        id: "update",
        name: "update_note",
        label: "Update note",
        status: "complete",
        resultJson: JSON.stringify({ before: "Old line", after: "New line" }),
      },
      {
        t,
        isDebugMode: true,
        onOpenToolOutput,
        app: {} as never,
        markdownContext: {} as never,
      } as never,
    );

    expect(list.querySelector(".ixplorer-chat__diff-line--remove")?.textContent).toContain(
      "Old line",
    );
    expect(list.querySelector(".ixplorer-chat__diff-line--add")?.textContent).toContain("New line");
    const cell = list.querySelector<HTMLElement>(".ixplorer-chat__tool-cell")!;
    cell.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(onOpenToolOutput).toHaveBeenCalledWith(expect.objectContaining({ id: "update" }));
  });
});
