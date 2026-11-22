import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "@adapters/settings";
import {
  createResearchExportService,
  type CompositionContext,
} from "@apps/obsidian/composition/factories";
import { createConversationSourceRegistry } from "@core/chat/sourceRegistry";
import { TFile, Vault } from "../support/obsidian";
import { finishedReport } from "../support/deepResearch";

describe("deep research export composition", () => {
  it("creates the nested folder and never writes over a racing or case-folded note", async () => {
    const vault = new Vault();
    vault.caseInsensitive = true;
    vault.adapter = {
      exists: async (path: string) =>
        vault.getFiles().some((file) => file.path.toLowerCase() === path.toLowerCase()),
    };
    const settings = { ...DEFAULT_SETTINGS, researchExportFolder: "Reports/Deep" };
    const ctx = { app: { vault }, getSettings: () => settings } as unknown as CompositionContext;
    const service = createResearchExportService(
      ctx,
      {
        chatId: "chat-1",
        researchId: "research-1",
        title: "Tides",
        registry: createConversationSourceRegistry(),
      },
      () => new Date(2026, 2, 4, 23, 59),
    );
    vault.setFiles([new TFile("Reports/Deep/TIDES - 2026-03-04.md")]);
    vault.beforeCreate.push((path) => {
      if (path === "Reports/Deep/Tides - 2026-03-04 (2).md") {
        vault.setFiles([...vault.getFiles(), new TFile(path)]);
      }
    });

    const { path } = await service.export(finishedReport("Body"));

    expect(path).toBe("Reports/Deep/Tides - 2026-03-04 (3).md");
    expect([...vault.contents.keys()]).toEqual([path]);
    expect(vault.getAbstractFileByPath("Reports")).not.toBeNull();
    expect(vault.getAbstractFileByPath("Reports/Deep")).not.toBeNull();
  });
});
