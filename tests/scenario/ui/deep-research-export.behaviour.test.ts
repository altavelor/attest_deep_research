// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTranslator } from "@adapters/i18n";
import { ResearchExportService } from "@application/use-cases/research/deep-research";
import { renderResearchCard } from "@apps/obsidian/ui/chat/deep-research/researchPlanCard";
import { createConversationSourceRegistry } from "@core/chat/sourceRegistry";
import type { ResearchHistoryEntry } from "@core/research/deepResearch";
import { settle } from "../../support/async";
import { installObsidianDomHelpers, resetDom } from "../../support/domHarness";
import { finishedReport, MemoryResearchNotes } from "../../support/deepResearch";

const t = createTranslator("en").t;

beforeEach(() => installObsidianDomHelpers());
afterEach(() => resetDom());

describe("deep research export from the report card", () => {
  it("keeps the report after a failed export and lets the retry write the note", async () => {
    const report = finishedReport("Tides follow the moon.");
    const { markdown: _markdown, ...summary } = report;
    const entry: ResearchHistoryEntry = {
      researchId: "research-1",
      question: "Why are there tides?",
      phase: "completed",
      terminalReason: null,
      createdAt: report.createdAt,
      updatedAt: report.createdAt,
      report: summary,
    };
    const before = JSON.stringify(entry);
    const notes = new MemoryResearchNotes();
    notes.failures = 1;
    const service = new ResearchExportService({
      writer: notes,
      defaultFolder: () => "Attest/Research",
      now: () => new Date(2026, 2, 4),
      context: {
        chatId: "chat-1",
        researchId: "research-1",
        title: entry.question,
        registry: createConversationSourceRegistry(),
      },
    });
    const host = document.createElement("div");
    renderResearchCard(
      host,
      { researchId: "research-1", artifact: "plan", revision: 1 },
      {
        view: { status: "ready", active: null, history: [entry] },
        t,
        sentTurns: new Set(),
        onTurn: () => {},
        onExport: () => service.export(report),
      },
    );
    const button = (): HTMLButtonElement =>
      [...host.querySelectorAll("button")].find((candidate) =>
        candidate.textContent?.includes("xport"),
      )!;

    button().click();
    expect(button().disabled).toBe(true);
    await settle();
    expect(host.textContent).toContain("Export failed: Disk is full.");
    expect(button().textContent).toBe("Retry export");
    expect(button().disabled).toBe(false);
    expect(notes.files.size).toBe(0);
    expect(JSON.stringify(entry)).toBe(before);

    button().click();
    await settle();
    const path = "Attest/Research/Why are there tides - 2026-03-04.md";
    expect(host.textContent).toContain(`Exported to ${path}`);
    expect(notes.files.get(path)).toContain("Tides follow the moon.");
    expect(JSON.stringify(entry)).toBe(before);
  });
});
