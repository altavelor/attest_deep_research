import { describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS,
  IxplorerSettings,
  cloneIndexProfile,
  createIndexProfile,
  getActiveIndexProfile,
  normalizeSettingsState,
  readSettings,
} from "@adapters/settings";
import type { ChatModelProfile, EmbeddingModelProfile, ServerProfile } from "@adapters/settings";

describe("new chat defaults", () => {
  it("migrates the removed active-profile and active-file keys in memory and drops them", () => {
    const settings = readSettings(
      legacySettings({
        activeChatModelProfileId: "chat-a",
        activeIndexProfileId: "index-a",
        includeActiveFileContext: false,
      }),
    );

    expect(settings.newChatDefaults).toEqual({
      searchMode: "indexOnly",
      indexProfileId: "index-a",
      researchMode: "instant",
      chatModelProfileId: "chat-a",
      includeActiveFileContext: false,
    });
    expect(settings).not.toHaveProperty("activeChatModelProfileId");
    expect(settings).not.toHaveProperty("activeIndexProfileId");
    expect(settings).not.toHaveProperty("includeActiveFileContext");
  });

  it("keeps an explicit new-chat defaults group instead of the legacy keys", () => {
    const settings = readSettings(
      legacySettings({
        activeChatModelProfileId: "chat-a",
        activeIndexProfileId: "index-a",
        includeActiveFileContext: false,
        newChatDefaults: {
          searchMode: "indexAndWeb",
          indexProfileId: "index-a",
          researchMode: "instant",
          chatModelProfileId: "chat-a",
          includeActiveFileContext: true,
        },
      }),
    );

    expect(settings.newChatDefaults.searchMode).toBe("indexAndWeb");
    expect(settings.newChatDefaults.includeActiveFileContext).toBe(true);
  });

  it("ignores the legacy keys when a partial new-chat defaults group is present", () => {
    const settings = readSettings(
      legacySettings({
        activeChatModelProfileId: "chat-a",
        activeIndexProfileId: "index-a",
        includeActiveFileContext: false,
        newChatDefaults: { searchMode: "none" },
        chatModelProfiles: [],
        indexProfiles: [],
      }),
    );

    expect(settings.newChatDefaults).toEqual({
      searchMode: "none",
      indexProfileId: "",
      researchMode: "instant",
      chatModelProfileId: "",
      includeActiveFileContext: true,
    });
  });

  it("falls back to the safe defaults for new or corrupted settings", () => {
    expect(readSettings(null).newChatDefaults).toEqual({
      searchMode: "indexOnly",
      indexProfileId: "",
      researchMode: "instant",
      chatModelProfileId: "",
      includeActiveFileContext: true,
    });
    expect(readSettings({ newChatDefaults: { searchMode: "everything" } }).newChatDefaults).toEqual(
      DEFAULT_SETTINGS.newChatDefaults,
    );
  });

  it("normalizes deleted, suspended, and unknown selections to the first available profile", () => {
    const settings = baseSettings();
    settings.newChatDefaults.chatModelProfileId = "missing";
    settings.newChatDefaults.indexProfileId = "missing";
    settings.newChatDefaults.searchMode = "webOnly";

    normalizeSettingsState(settings);

    expect(settings.newChatDefaults.chatModelProfileId).toBe("chat-a");
    expect(settings.newChatDefaults.indexProfileId).toBe("index-a");
    expect(settings.newChatDefaults.searchMode).toBe("webOnly");
  });

  it("clears the selections when no available profile is left", () => {
    const settings = baseSettings();
    settings.serverProfiles[0].isSuspended = true;
    settings.newChatDefaults.chatModelProfileId = "chat-a";
    settings.newChatDefaults.indexProfileId = "index-a";

    normalizeSettingsState(settings);

    expect(settings.newChatDefaults.chatModelProfileId).toBe("");
    expect(settings.newChatDefaults.indexProfileId).toBe("");
  });

  it("degrades thinking to instant when the default model has no verified agent capability", () => {
    const settings = baseSettings();
    settings.newChatDefaults.researchMode = "thinking";

    normalizeSettingsState(settings);

    expect(settings.newChatDefaults.researchMode).toBe("instant");
  });

  it("keeps thinking for a default model with a verified agent capability", () => {
    const settings = baseSettings();
    settings.chatModelProfiles[0].reasoningCapabilities = {
      source: "probe",
      responses: true,
      continuation: true,
      summary: false,
      efforts: ["medium"],
    };
    settings.newChatDefaults.researchMode = "thinking";

    normalizeSettingsState(settings);

    expect(settings.newChatDefaults.researchMode).toBe("thinking");
  });

  it("resolves the active index profile past a suspended default selection", () => {
    const settings = baseSettings();
    settings.indexProfiles = [
      { ...settings.indexProfiles[0], id: "index-suspended", isSuspended: true },
      { ...settings.indexProfiles[0], id: "index-b", isSuspended: false },
    ];
    settings.newChatDefaults.indexProfileId = "index-suspended";

    expect(getActiveIndexProfile(settings).id).toBe("index-b");
  });

  it("keeps a non-indexed index profile selectable as the default index", () => {
    const settings = baseSettings();
    settings.newChatDefaults.indexProfileId = "index-a";

    normalizeSettingsState(settings);

    expect(settings.indexProfiles[0].lastIndexedAt).toBeUndefined();
    expect(settings.newChatDefaults.indexProfileId).toBe("index-a");
  });
});

function serverProfile(): ServerProfile {
  return {
    id: "server",
    name: "Server",
    apiFormat: "openai-compatible",
    baseUrl: "https://example.test/v1",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  };
}

function chatProfile(): ChatModelProfile {
  return {
    id: "chat-a",
    name: "Chat A",
    serverProfileId: "server",
    modelName: "model",
    toolsEnabled: true,
    noteMutationAccess: false,
    reasoning: { mode: "off", summary: "off" },
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  };
}

function embeddingProfile(): EmbeddingModelProfile {
  return {
    id: "embedding",
    name: "Embedding",
    serverProfileId: "server",
    modelName: "embed",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  };
}

function baseSettings(): IxplorerSettings {
  return {
    ...DEFAULT_SETTINGS,
    newChatDefaults: { ...DEFAULT_SETTINGS.newChatDefaults },
    serverProfiles: [serverProfile()],
    chatModelProfiles: [chatProfile()],
    embeddingModelProfiles: [embeddingProfile()],
    indexProfiles: [
      createIndexProfile({
        ...cloneIndexProfile(DEFAULT_SETTINGS.indexProfiles[0]),
        id: "index-a",
        name: "Index A",
        embeddingModelProfileId: "embedding",
      }),
    ],
  };
}

function legacySettings(overrides: Record<string, unknown>): Record<string, unknown> {
  const settings = baseSettings() as unknown as Record<string, unknown>;
  delete settings.newChatDefaults;
  return { ...settings, ...overrides };
}
