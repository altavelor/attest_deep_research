import { DEFAULT_SETTINGS, cloneIndexProfile, createIndexProfile } from "@adapters/settings";
import { readSettings } from "@adapters/settings";
import {
  formatListInput,
  normalizeListInput,
  normalizeUrl,
  normalizeVaultFolder,
} from "@adapters/settings";
import {
  getActiveIndexProfile,
  isValidIndexProfileName,
  resolveChatModelProfile,
  resolveEffectiveChatApiProtocol,
  resolveEffectiveReasoning,
  resolveEffectiveTools,
  updateActiveIndexProfile,
} from "@adapters/settings";
import { isIndexProfileSelectable } from "@adapters/settings";
import { createToolCapabilitySettings, withProbeResults } from "@adapters/settings";
import { AttestSettings } from "@adapters/settings";

describe("Attest settings", () => {
  it("uses local-first safe defaults when saved data is absent or not current", () => {
    expect(readSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(readSettings({ includeFolders: ["Notes"] })).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.serverProfiles).toEqual([]);
    expect(DEFAULT_SETTINGS.chatModelProfiles).toEqual([]);
    expect(DEFAULT_SETTINGS.embeddingModelProfiles).toEqual([]);
    expect(DEFAULT_SETTINGS.newChatDefaults).toEqual({
      searchMode: "indexOnly",
      indexProfileId: "",
      researchMode: "instant",
      chatModelProfileId: "",
      includeActiveFileContext: true,
    });
    expect(getActiveIndexProfile(DEFAULT_SETTINGS)).toMatchObject({
      id: "default",
      indexFolder: ".attest/index",
      embeddingModelProfileId: "",
      isSuspended: true,
      shardCount: 32,
      mode: "wholeVault",
      chunkSize: 800,
      chunkOverlap: 120,
    });
  });

  it("loads current settings and normalizes dependent profile state", () => {
    const settings = readSettings(
      currentSettings({
        serverProfiles: [
          {
            id: "server-openrouter",
            name: "OpenRouter",
            apiFormat: "openai-compatible",
            baseUrl: "https://openrouter.ai/api/v1",
            isSuspended: true,
            createdAt: "2026-06-01T00:00:00.000Z",
            updatedAt: "2026-06-01T00:00:00.000Z",
          },
        ],
        chatModelProfiles: [
          {
            id: "chat-a",
            name: "Main chat",
            serverProfileId: "server-openrouter",
            modelName: "openai/gpt-4.1",
            toolsEnabled: true,
            noteMutationAccess: true,
            reasoning: { mode: "off", summary: "off" },
            createdAt: "2026-06-01T00:00:00.000Z",
            updatedAt: "2026-06-01T00:00:00.000Z",
          },
        ],
        newChatDefaults: { ...DEFAULT_SETTINGS.newChatDefaults, chatModelProfileId: "chat-a" },
        debugMode: true,
      }),
    );

    expect(settings.serverProfiles[0]).toMatchObject({
      id: "server-openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
    });
    expect(settings.chatModelProfiles[0]).toMatchObject({
      id: "chat-a",
      isSuspended: true,
      suspendedReason: "Server profile is suspended.",
    });
    expect(settings.newChatDefaults.chatModelProfileId).toBe("");
    expect(settings.debugMode).toBe(true);
  });

  it("ignores the removed forceEagerResearch key in existing saved settings", () => {
    const savedWithLegacyKey = {
      ...currentSettings(),
      forceEagerResearch: true,
    };

    const settings = readSettings(savedWithLegacyKey);

    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(settings).not.toHaveProperty("forceEagerResearch");
  });

  it("loads settings saved with the removed showChatIndexControl key and drops it", () => {
    const savedWithRemovedKey = {
      ...currentSettings(),
      showChatIndexControl: true,
    };

    const settings = readSettings(savedWithRemovedKey);

    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(settings).not.toHaveProperty("showChatIndexControl");
  });

  it("loads settings saved without the removed showChatIndexControl key", () => {
    const settings = readSettings(currentSettings({ debugMode: true }));

    expect(settings.debugMode).toBe(true);
    expect(settings).not.toHaveProperty("showChatIndexControl");
  });

  it("preserves current settings while dropping an unknown legacy setting", () => {
    const settings = readSettings({
      ...currentSettings({ debugMode: true }),
      legacyIndexFolder: ".attest/legacy-index",
    });

    expect(settings.debugMode).toBe(true);
    expect(settings).not.toHaveProperty("legacyIndexFolder");
  });

  it("defaults query expansion on for settings saved before it became toggleable", () => {
    const { expandSearchQuery: _omitted, ...withoutFlag } = currentSettings();

    expect(readSettings(withoutFlag).expandSearchQuery).toBe(true);
  });

  it("preserves an explicit query expansion opt-out", () => {
    const settings = readSettings(currentSettings({ expandSearchQuery: false }));

    expect(settings.expandSearchQuery).toBe(false);
  });

  it("resolves current tool and reasoning settings", () => {
    const profile = currentSettings({
      serverProfiles: [
        {
          id: "s",
          name: "S",
          apiFormat: "openai-compatible",
          baseUrl: "https://example.test/v1",
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
        },
      ],
      chatModelProfiles: [
        {
          id: "m",
          name: "M",
          serverProfileId: "s",
          modelName: "model",
          toolsEnabled: true,
          noteMutationAccess: true,
          reasoning: { mode: "auto", summary: "off" },
          reasoningCapabilities: {
            source: "probe",
            responses: true,
            continuation: true,
            summary: false,
            efforts: ["medium"],
            requiresEffort: true,
            defaultEffort: "medium",
          },
          capabilities: {
            chat: true,
            embeddings: false,
            toolCalling: withProbeResults(createToolCapabilitySettings(false), { calls: true }),
            detectionSource: "probe",
          },
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
        },
      ],
    }).chatModelProfiles[0];

    expect(resolveEffectiveTools(profile)).toBe(true);
    expect(resolveEffectiveChatApiProtocol(profile)).toBe("responses");
    expect(resolveEffectiveReasoning(profile, "responses")).toEqual({
      enabled: true,
      effort: "medium",
      summary: "off",
    });
  });

  it("normalizes active index updates and validates index names", () => {
    const settings = readSettings(currentSettings());

    updateActiveIndexProfile(settings, { chunkSize: 100, chunkOverlap: 200 });

    expect(getActiveIndexProfile(settings)).toMatchObject({
      chunkSize: 100,
      chunkOverlap: 99,
    });
    expect(isValidIndexProfileName("Research index [A]")).toBe(true);
    expect(isValidIndexProfileName("")).toBe(false);
    expect(isValidIndexProfileName("A".repeat(61))).toBe(false);
    expect(isValidIndexProfileName("Bad/name")).toBe(false);
  });

  it("resolves selectable profiles and editable list text", () => {
    const settings = readSettings(
      currentSettings({
        serverProfiles: [
          {
            id: "server-a",
            name: "Server A",
            apiFormat: "openai-compatible",
            baseUrl: "https://example.com/v1",
            createdAt: "2026-06-01T00:00:00.000Z",
            updatedAt: "2026-06-01T00:00:00.000Z",
          },
        ],
        chatModelProfiles: [
          {
            id: "chat-a",
            name: "Chat A",
            serverProfileId: "server-a",
            modelName: "model-a",
            toolsEnabled: true,
            noteMutationAccess: true,
            reasoning: { mode: "off", summary: "off" },
            createdAt: "2026-06-01T00:00:00.000Z",
            updatedAt: "2026-06-01T00:00:00.000Z",
          },
        ],
        newChatDefaults: { ...DEFAULT_SETTINGS.newChatDefaults, chatModelProfileId: "chat-a" },
      }),
    );

    expect(resolveChatModelProfile(settings, "chat-a")?.id).toBe("chat-a");
    expect(
      isIndexProfileSelectable({
        ...DEFAULT_SETTINGS.indexProfiles[0],
        isSuspended: false,
        lastIndexedAt: "2026-06-14T10:00:00.000Z",
      }),
    ).toBe(true);
    expect(normalizeListInput("Research\n\n Papers \n")).toEqual(["Research", "Papers"]);
    expect(formatListInput(["Research", "Papers"])).toBe("Research\nPapers");
    expect(normalizeUrl(" http://localhost:1234/v1/ ", "fallback")).toBe(
      "http://localhost:1234/v1",
    );
    expect(normalizeVaultFolder(" /.attest/index/ ")).toBe(".attest/index");
  });
});

function currentSettings(overrides: Partial<AttestSettings> = {}): AttestSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...overrides,
    serverProfiles: overrides.serverProfiles?.map((profile) => ({ ...profile })) ?? [],
    chatModelProfiles: overrides.chatModelProfiles?.map((profile) => ({ ...profile })) ?? [],
    embeddingModelProfiles:
      overrides.embeddingModelProfiles?.map((profile) => ({ ...profile })) ?? [],
    indexProfiles: overrides.indexProfiles?.map(cloneIndexProfile) ?? [
      createIndexProfile({
        ...DEFAULT_SETTINGS.indexProfiles[0],
        isSuspended: false,
        suspendedReason: undefined,
        embeddingModelProfileId: "",
      }),
    ],
    includeFolders: overrides.includeFolders ?? [...DEFAULT_SETTINGS.includeFolders],
    excludeGlobs: overrides.excludeGlobs ?? [...DEFAULT_SETTINGS.excludeGlobs],
    modelCapabilityCache: overrides.modelCapabilityCache ?? {},
  };
}

describe("index profile suspension", () => {
  const timestamps = {
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  };

  function settingsWith(
    embeddingModelProfileId: string,
    overrides: Partial<AttestSettings> = {},
  ): AttestSettings {
    return readSettings(
      currentSettings({
        serverProfiles: [
          {
            id: "server-openrouter",
            name: "OpenRouter",
            apiFormat: "openai-compatible",
            baseUrl: "https://openrouter.ai/api/v1",
            ...timestamps,
          },
        ],
        embeddingModelProfiles: [
          {
            id: "embedding-a",
            name: "OpenRouter embeddings",
            serverProfileId: "server-openrouter",
            modelName: "openai/text-embedding-3-small",
            ...timestamps,
          },
        ],
        indexProfiles: [
          createIndexProfile({
            ...DEFAULT_SETTINGS.indexProfiles[0],
            embeddingModelProfileId,
            isSuspended: false,
            suspendedReason: undefined,
          }),
        ],
        ...overrides,
      }),
    );
  }

  it("keeps an index usable while its whole embedding chain resolves", () => {
    expect(settingsWith("embedding-a").indexProfiles[0]).toMatchObject({
      isSuspended: false,
      suspendedReason: undefined,
    });
  });

  it("suspends an index whose embedding model profile was deleted", () => {
    expect(settingsWith("embedding-removed").indexProfiles[0]).toMatchObject({
      isSuspended: true,
      suspendedReason: "The selected embedding model profile was deleted.",
    });
  });

  it("suspends an index that never had an embedding model selected", () => {
    expect(settingsWith("").indexProfiles[0]).toMatchObject({
      isSuspended: true,
      suspendedReason: "Select an embedding model profile.",
    });
  });

  it("suspends an index whose embedding model profile has no model name", () => {
    const settings = settingsWith("embedding-a", {
      embeddingModelProfiles: [
        {
          id: "embedding-a",
          name: "OpenRouter embeddings",
          serverProfileId: "server-openrouter",
          modelName: "   ",
          ...timestamps,
        },
      ],
    });

    expect(settings.indexProfiles[0]).toMatchObject({
      isSuspended: true,
      suspendedReason: "The embedding model profile has no model selected.",
    });
  });

  it("suspends the server profile with an unusable base URL and everything downstream", () => {
    const settings = settingsWith("embedding-a", {
      serverProfiles: [
        {
          id: "server-openrouter",
          name: "OpenRouter",
          apiFormat: "openai-compatible",
          baseUrl: "openrouter.ai/api/v1",
          ...timestamps,
        },
      ],
    });

    expect(settings.serverProfiles[0]).toMatchObject({
      isSuspended: true,
      suspendedReason: "The server profile has an invalid base URL.",
    });
    expect(settings.embeddingModelProfiles[0]).toMatchObject({
      isSuspended: true,
      suspendedReason: "Server profile is suspended.",
    });
    expect(settings.indexProfiles[0]).toMatchObject({
      isSuspended: true,
      suspendedReason: "Server profile is suspended.",
    });
  });

  it("releases the whole chain once an invalid base URL is corrected", () => {
    const settings = settingsWith("embedding-a", {
      serverProfiles: [
        {
          id: "server-openrouter",
          name: "OpenRouter",
          apiFormat: "openai-compatible",
          baseUrl: "https://openrouter.ai/api/v1",
          isSuspended: true,
          suspendedReason: "The server profile has an invalid base URL.",
          ...timestamps,
        },
      ],
    });

    expect(settings.serverProfiles[0]).toMatchObject({
      isSuspended: false,
      suspendedReason: undefined,
    });
    expect(settings.embeddingModelProfiles[0]).toMatchObject({ isSuspended: false });
    expect(settings.indexProfiles[0]).toMatchObject({
      isSuspended: false,
      suspendedReason: undefined,
    });
  });

  it("keeps a manually suspended server profile suspended", () => {
    const settings = settingsWith("embedding-a", {
      serverProfiles: [
        {
          id: "server-openrouter",
          name: "OpenRouter",
          apiFormat: "openai-compatible",
          baseUrl: "https://openrouter.ai/api/v1",
          isSuspended: true,
          ...timestamps,
        },
      ],
    });

    expect(settings.serverProfiles[0]).toMatchObject({
      isSuspended: true,
      suspendedReason: "Server profile is suspended.",
    });
    expect(settings.indexProfiles[0]).toMatchObject({ isSuspended: true });
  });

  it("propagates the embedding profile's own reason when its server was deleted", () => {
    const settings = settingsWith("embedding-a", { serverProfiles: [] });

    expect(settings.embeddingModelProfiles[0]).toMatchObject({
      isSuspended: true,
      suspendedReason: "Server profile was deleted.",
    });
    expect(settings.indexProfiles[0]).toMatchObject({
      isSuspended: true,
      suspendedReason: "Server profile was deleted.",
    });
  });

  it("releases an unverified embedding verdict once its server profile is edited", () => {
    const settings = settingsWith("embedding-a", {
      serverProfiles: [
        {
          id: "server-openrouter",
          name: "OpenRouter",
          apiFormat: "openai-compatible",
          baseUrl: "https://openrouter.ai/api/v1",
          createdAt: timestamps.createdAt,
          updatedAt: "2026-06-02T00:00:00.000Z",
        },
      ],
      embeddingModelProfiles: [
        {
          id: "embedding-a",
          name: "OpenRouter embeddings",
          serverProfileId: "server-openrouter",
          modelName: "openai/text-embedding-3-small",
          isSuspended: true,
          suspendedReason: "Embedding capability could not be verified.",
          ...timestamps,
        },
      ],
    });

    expect(settings.embeddingModelProfiles[0]).toMatchObject({
      isSuspended: false,
      suspendedReason: undefined,
    });
    expect(settings.indexProfiles[0]).toMatchObject({
      isSuspended: false,
      suspendedReason: undefined,
    });
  });

  it("propagates an unverified embedding capability to the index", () => {
    const settings = settingsWith("embedding-a", {
      embeddingModelProfiles: [
        {
          id: "embedding-a",
          name: "OpenRouter embeddings",
          serverProfileId: "server-openrouter",
          modelName: "openai/text-embedding-3-small",
          isSuspended: true,
          suspendedReason: "Embedding capability could not be verified.",
          ...timestamps,
        },
      ],
    });

    expect(settings.indexProfiles[0]).toMatchObject({
      isSuspended: true,
      suspendedReason: "Embedding capability could not be verified.",
    });
  });
});
