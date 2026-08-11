// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "@adapters/settings";
import { ModelProfilesSection } from "@apps/obsidian/ui/settings/ModelProfilesSection";
import { createTranslator } from "@adapters/i18n";
import { createContainer, installObsidianDomHelpers, resetDom } from "../helpers/domHarness";

const t = createTranslator("en").t;

describe("ModelProfilesSection", () => {
  beforeEach(installObsidianDomHelpers);
  afterEach(resetDom);

  it("sets an available embedding profile as default and keeps a suspended profile disabled", async () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      embeddingModelProfiles: [
        {
          id: "available",
          name: "Available embeddings",
          serverProfileId: "server",
          modelName: "embed",
          createdAt: "now",
          updatedAt: "now",
        },
        {
          id: "suspended",
          name: "Suspended embeddings",
          serverProfileId: "server",
          modelName: "embed-2",
          isSuspended: true,
          createdAt: "now",
          updatedAt: "now",
        },
      ],
    };
    const saveSettings = vi.fn(async () => {});
    const requestRedisplay = vi.fn();
    const section = new ModelProfilesSection({
      app: {} as never,
      t,
      settings,
      fetchedModelsByServerId: new Map(),
      prober: { statusFor: () => ({ tools: "not-tested", agent: "not-tested" }) } as never,
      saveSettings,
      requestRedisplay,
    });
    const container = createContainer();

    section.render(container);
    const defaults = container.querySelectorAll<HTMLButtonElement>(
      ".attest-settings__default-action",
    );
    expect(defaults).toHaveLength(2);
    expect(defaults[1]!.disabled).toBe(true);
    defaults[0]!.click();
    await Promise.resolve();

    expect(settings.activeEmbeddingModelProfileId).toBe("available");
    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(requestRedisplay).toHaveBeenCalledTimes(1);
  });

  it("runs a forced capability probe from the chat-model action", async () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      chatModelProfiles: [
        {
          id: "chat",
          name: "Research model",
          serverProfileId: "server",
          modelName: "chat-model",
          toolsEnabled: true,
          noteMutationAccess: false,
          reasoning: { mode: "off" as const, summary: "off" as const },
          createdAt: "now",
          updatedAt: "now",
        },
      ],
    };
    const prober = {
      statusFor: () => ({ tools: "not-tested", agent: "not-tested" }),
      refreshMetadataCapabilities: vi.fn(async () => {}),
      startChatProfileProbes: vi.fn(),
    };
    const section = new ModelProfilesSection({
      app: {} as never,
      t,
      settings,
      fetchedModelsByServerId: new Map(),
      prober: prober as never,
      saveSettings: vi.fn(async () => {}),
      requestRedisplay: vi.fn(),
    });
    const container = createContainer();

    section.render(container);
    container
      .querySelector<HTMLButtonElement>(".attest-settings__test-capabilities-action")!
      .click();
    await Promise.resolve();

    expect(prober.refreshMetadataCapabilities).toHaveBeenCalledTimes(1);
    expect(prober.startChatProfileProbes).toHaveBeenCalledWith("chat", true);
  });

  it("deletes an unused server profile but disables deletion while it is referenced", async () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      serverProfiles: [
        {
          id: "unused",
          name: "Unused server",
          apiFormat: "openai-compatible" as const,
          baseUrl: "https://unused.example.com/v1",
          createdAt: "now",
          updatedAt: "now",
        },
        {
          id: "used",
          name: "Used server",
          apiFormat: "openai-compatible" as const,
          baseUrl: "https://used.example.com/v1",
          createdAt: "now",
          updatedAt: "now",
        },
      ],
      chatModelProfiles: [
        {
          id: "chat",
          name: "Chat",
          serverProfileId: "used",
          modelName: "model",
          toolsEnabled: false,
          noteMutationAccess: false,
          reasoning: { mode: "off" as const, summary: "off" as const },
          createdAt: "now",
          updatedAt: "now",
        },
      ],
    };
    const saveSettings = vi.fn(async () => {});
    const section = new ModelProfilesSection({
      app: {} as never,
      t,
      settings,
      fetchedModelsByServerId: new Map(),
      prober: { statusFor: () => ({ tools: "not-tested", agent: "not-tested" }) } as never,
      saveSettings,
      requestRedisplay: vi.fn(),
    });
    const container = createContainer();

    section.render(container);
    const rows = container.querySelectorAll<HTMLElement>(".attest-settings-profile-list__item");
    const unusedRow = Array.from(rows).find((row) => row.textContent?.includes("Unused server"))!;
    const usedRow = Array.from(rows).find((row) => row.textContent?.includes("Used server"))!;
    const unusedDelete = unusedRow.querySelectorAll<HTMLButtonElement>("button").item(1);
    const usedDelete = usedRow.querySelectorAll<HTMLButtonElement>("button").item(1);

    expect(usedDelete.disabled).toBe(true);
    unusedDelete.click();
    await Promise.resolve();
    expect(settings.serverProfiles.map((profile) => profile.id)).toEqual(["used"]);
    expect(saveSettings).toHaveBeenCalledTimes(1);
  });
});
