import { describe, expect, it, vi } from "vitest";

import { TFile, takeNotices } from "../stubs/obsidian";
import { ToolOutputViewer } from "@apps/obsidian/ui/chat/toolOutputViewer";

function file(path: string): TFile {
  return Object.assign(Object.create(TFile.prototype), { path });
}

function appFor(existing: TFile | null = null) {
  const openFile = vi.fn().mockResolvedValue(undefined);
  return {
    vault: {
      getFolderByPath: vi.fn(() => null),
      createFolder: vi.fn().mockResolvedValue(undefined),
      getAbstractFileByPath: vi.fn(() => existing),
      create: vi.fn().mockResolvedValue(file("Attest/tool-output.md")),
      modify: vi.fn().mockResolvedValue(undefined),
    },
    workspace: { getLeaf: vi.fn(() => ({ openFile })) },
    openFile,
  };
}

describe("ToolOutputViewer", () => {
  it("creates the scratch folder and opens a formatted note for a new tool output", async () => {
    const app = appFor();
    const viewer = new ToolOutputViewer(
      app as never,
      ((key: string, values?: Record<string, unknown>) => `${key}:${values?.error ?? ""}`) as never,
    );

    await viewer.open({
      name: "search_index",
      intent: "Search local index",
      status: "complete",
      args: { query: "Attest" },
      resultJson: '{"hits":1}',
    });

    expect(app.vault.createFolder).toHaveBeenCalledWith("Attest");
    expect(app.vault.create).toHaveBeenCalledWith(
      "Attest/tool-output.md",
      expect.stringContaining('"hits": 1'),
    );
    expect(app.workspace.getLeaf).toHaveBeenCalledWith("tab");
    expect(app.openFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: "Attest/tool-output.md" }),
    );
  });

  it("updates the reusable note instead of creating another one", async () => {
    const existing = file("Attest/tool-output.md");
    const app = appFor(existing);
    const viewer = new ToolOutputViewer(
      app as never,
      ((key: string, values?: Record<string, unknown>) => `${key}:${values?.error ?? ""}`) as never,
    );

    await viewer.open({ name: "read_note", intent: "Read note", status: "complete" });

    expect(app.vault.modify).toHaveBeenCalledWith(existing, expect.stringContaining("# read_note"));
    expect(app.vault.create).not.toHaveBeenCalled();
    expect(app.openFile).toHaveBeenCalledWith(existing);
  });

  it("shows a notice and leaves the workspace untouched when the scratch note cannot be written", async () => {
    takeNotices();
    const app = appFor();
    app.vault.create.mockRejectedValueOnce(new Error("vault read-only"));
    const viewer = new ToolOutputViewer(
      app as never,
      ((key: string, values?: Record<string, unknown>) => `${key}:${values?.error ?? ""}`) as never,
    );

    await viewer.open({ name: "fetch_url", intent: "Fetch page", status: "failed" });

    expect(app.openFile).not.toHaveBeenCalled();
    expect(takeNotices()[0]?.message).toBe("chat.toolOutput.openFailed:Error: vault read-only");
  });
});
