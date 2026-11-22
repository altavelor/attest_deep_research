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
  it("writes through the vault into the configured folder and never over a racing note", async () => {
    const vault = new Vault();
    const settings = { ...DEFAULT_SETTINGS, researchExportFolder: "Reports" };
    const ctx = { app: { vault }, getSettings: () => settings } as unknown as CompositionContext;
    const service = createResearchExportService(ctx, {
      chatId: "chat-1",
      researchId: "research-1",
      title: "Tides",
      registry: createConversationSourceRegistry(),
    });
    const report = finishedReport("Body");
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    vault.setFiles([new TFile(`Reports/Tides - ${date}.md`)]);
    vault.beforeCreate.push((path) => {
      if (path === `Reports/Tides - ${date} (2).md`) {
        vault.setFiles([...vault.getFiles(), new TFile(path)]);
      }
    });

    const { path } = await service.export(report);

    expect(path).toBe(`Reports/Tides - ${date} (3).md`);
    expect([...vault.contents.keys()]).toEqual([path]);
    expect(vault.getAbstractFileByPath("Reports")).not.toBeNull();
  });
});
