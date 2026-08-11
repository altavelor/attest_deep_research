// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../stubs/obsidian";

import { createTranslator } from "@adapters/i18n";
import { DEFAULT_INDEX_PROFILE } from "@adapters/settings";
import { IndexReportModal } from "@apps/obsidian/ui/settings/IndexReportModal";
import type { App as ObsidianApp } from "obsidian";
import { installObsidianDomHelpers, resetDom } from "../helpers/domHarness";

const t = createTranslator("en").t;

const extraction = {
  model: "chat-model",
  promptVersion: 1,
  extractedAt: "2026-08-01T12:00:00.000Z",
};

describe("IndexReportModal", () => {
  beforeEach(installObsidianDomHelpers);
  afterEach(resetDom);

  it("renders indexed and failed files together with collected metadata and summaries", () => {
    const modal = new IndexReportModal(new App() as unknown as ObsidianApp, {
      t,
      profile: { ...DEFAULT_INDEX_PROFILE, name: "Research" },
      report: [
        {
          sourcePath: "Notes/paper.md",
          status: "indexed",
          modifiedTime: 1,
          indexedAt: "2026-08-01T12:00:00.000Z",
          chunkCount: 3,
        },
        {
          sourcePath: "Notes/broken.pdf",
          status: "failed",
          modifiedTime: 1,
          indexedAt: "",
          chunkCount: 0,
          errorMessage: "Unreadable PDF",
        },
      ],
      metadata: [
        {
          schemaVersion: 1,
          sourcePath: "Notes/paper.md",
          contentHash: "hash-a",
          title: "Paper title",
          authors: ["Ada", "Lin"],
          year: 2024,
          abstract: "A short abstract.",
          references: [{ raw: "Shared reference" }],
          extraction,
        },
        {
          schemaVersion: 1,
          sourcePath: "Notes/second.md",
          contentHash: "hash-b",
          references: [{ raw: "Shared reference" }],
          extraction,
        },
      ],
      summaries: [
        {
          schemaVersion: 1,
          sourcePath: "Notes/paper.md",
          contentHash: "hash-a",
          document: { summary: "Document summary.", oneLiner: "One line." },
          sections: [
            { headingPath: ["Methods"], chunkStart: 0, chunkEnd: 1, summary: "Method summary." },
          ],
          generation: {
            model: "chat-model",
            promptVersion: 1,
            generatedAt: "2026-08-01T12:00:00.000Z",
          },
        },
      ],
    });
    modal.open();

    const text = modal.contentEl.textContent ?? "";
    expect(text).toContain("1 indexed file");
    expect(text).toContain("1 failed file");
    expect(text).toContain("3 chunks");
    expect(text).toContain("2 enriched");
    expect(text).toContain("Shared reference");
    expect(text).toContain("Paper title · 2024 · 1 refs");
    expect(text).toContain("Ada, Lin");
    expect(text).toContain("Document summary.");
    expect(text).toContain("Methods: Method summary.");
    expect(text).toContain("Unreadable PDF");
    expect(modal.contentEl.querySelectorAll(".attest-index-report__row")).toHaveLength(2);
  });

  it("shows an empty-state message and close action when no report exists", () => {
    const modal = new IndexReportModal(new App() as unknown as ObsidianApp, {
      t,
      profile: DEFAULT_INDEX_PROFILE,
      report: [],
    });
    modal.open();

    expect(modal.contentEl.textContent).toContain("No indexing report is available yet.");
    const close = Array.from(modal.contentEl.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Close",
    );
    close!.click();
    expect(modal.contentEl.childElementCount).toBe(0);
  });
});
