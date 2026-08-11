import {
  indexSearchEmbedderWarning,
  requireChatModelProfile,
  requireEmbeddingModelProfile,
  requireIndexProfile,
  requireServerProfile,
  resolveIndexProfileForUse,
} from "@apps/obsidian/composition/profileResolvers";
import { createTranslator } from "@adapters/i18n";
import { DEFAULT_SETTINGS, cloneIndexProfile } from "@adapters/settings";
import type { EmbeddingModelProfile, AttestSettings, ServerProfile } from "@adapters/settings";

function createSettings(overrides: Partial<AttestSettings> = {}): AttestSettings {
  return {
    ...DEFAULT_SETTINGS,
    indexProfiles: DEFAULT_SETTINGS.indexProfiles.map(cloneIndexProfile),
    embeddingModelProfiles: [],
    ...overrides,
  };
}

function embeddingProfile(overrides: Partial<EmbeddingModelProfile> = {}): EmbeddingModelProfile {
  return {
    id: "embedding",
    name: "Embedding",
    serverProfileId: "server",
    modelName: "embed-model",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function serverProfile(): ServerProfile {
  return {
    id: "server",
    name: "Server",
    apiFormat: "openai-compatible",
    baseUrl: "http://localhost:1234/v1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const translate = createTranslator("en").t;

describe("index-search debug panel", () => {
  it("resolves requested and fallback indexed profiles, rejecting unavailable profiles", () => {
    const indexed = {
      ...createSettings().indexProfiles[0],
      id: "indexed",
      isSuspended: false,
      lastIndexedAt: "2026-01-01T00:00:00.000Z",
    };
    const requested = { ...indexed, id: "requested", name: "Requested" };
    const settings = createSettings({
      indexProfiles: [indexed, requested],
      newChatDefaults: { ...DEFAULT_SETTINGS.newChatDefaults, indexProfileId: "indexed" },
    });

    expect(resolveIndexProfileForUse(settings, translate, "requested")).toBe(requested);
    expect(resolveIndexProfileForUse(settings, translate)).toBe(indexed);
    expect(requireIndexProfile(settings, translate, "indexed")).toBe(indexed);
    expect(() => requireIndexProfile(settings, translate, "missing")).toThrow(
      "The selected index profile is unavailable.",
    );
    expect(() => resolveIndexProfileForUse(createSettings(), translate)).toThrow(
      "Index this profile before using it in chat or search.",
    );
  });

  it("requires available server and model profiles", () => {
    const chat = {
      id: "chat",
      name: "Chat",
      serverProfileId: "server",
      modelName: "chat-model",
      toolsEnabled: true,
      noteMutationAccess: false,
      reasoning: { mode: "off" as const, summary: "off" as const },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const embedding = embeddingProfile();
    const settings = createSettings({
      serverProfiles: [serverProfile()],
      chatModelProfiles: [chat],
      embeddingModelProfiles: [embedding],
      newChatDefaults: { ...DEFAULT_SETTINGS.newChatDefaults, chatModelProfileId: "chat" },
    });

    expect(requireChatModelProfile(settings, translate).id).toBe("chat");
    expect(requireEmbeddingModelProfile(settings, translate, "embedding").id).toBe("embedding");
    expect(requireServerProfile(settings, translate, "server").id).toBe("server");
    expect(() => requireChatModelProfile(createSettings(), translate)).toThrow(
      "Select a chat model profile before asking a question.",
    );
    expect(() => requireEmbeddingModelProfile(settings, translate, "missing")).toThrow(
      "Select an embedding model profile before using this index.",
    );
    expect(() => requireServerProfile(settings, translate, "missing")).toThrow(
      "The selected server profile is unavailable.",
    );
  });

  it("blocks search with a safe warning when the selected index has no usable embedder", () => {
    const settings = createSettings({
      embeddingModelProfiles: [],
      indexProfiles: [
        {
          ...createSettings().indexProfiles[0],
          id: "index",
          embeddingModelProfileId: "missing",
          lastIndexedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    expect(indexSearchEmbedderWarning(settings, translate, "index")).toBe(
      "The selected index's embedding model profile is unavailable. Update it in Attest settings.",
    );
  });

  it("blocks search when a capability check found the embedder unsuitable", () => {
    const settings = createSettings({
      serverProfiles: [serverProfile()],
      embeddingModelProfiles: [
        embeddingProfile({
          capabilities: { chat: false, embeddings: false, detectionSource: "probe" },
        }),
      ],
      indexProfiles: [
        {
          ...createSettings().indexProfiles[0],
          id: "index",
          embeddingModelProfileId: "embedding",
          lastIndexedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    expect(indexSearchEmbedderWarning(settings, translate, "index")).toBe(
      "The selected index's embedding model cannot create embeddings. Update it in Attest settings.",
    );
  });

  it("blocks search when the selected embedding profile is suspended", () => {
    const settings = createSettings({
      serverProfiles: [serverProfile()],
      embeddingModelProfiles: [embeddingProfile({ isSuspended: true })],
      indexProfiles: [
        {
          ...createSettings().indexProfiles[0],
          id: "index",
          embeddingModelProfileId: "embedding",
          lastIndexedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    expect(indexSearchEmbedderWarning(settings, translate, "index")).toBe(
      "The selected index's embedding model profile is suspended. Update it in Attest settings.",
    );
  });

  it("warns when no index is selected or its embedding server is unavailable", () => {
    expect(indexSearchEmbedderWarning(createSettings(), translate, "missing")).toBe(
      "Select an indexed profile in Attest settings before searching.",
    );

    const settings = createSettings({
      embeddingModelProfiles: [embeddingProfile()],
      indexProfiles: [
        {
          ...createSettings().indexProfiles[0],
          id: "index",
          embeddingModelProfileId: "embedding",
          lastIndexedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    expect(indexSearchEmbedderWarning(settings, translate, "index")).toBe(
      "The selected index's embedding server is unavailable. Update it in Attest settings.",
    );
  });

  it("allows search when the selected index has an available embedding profile", () => {
    const settings = createSettings({
      serverProfiles: [serverProfile()],
      embeddingModelProfiles: [
        embeddingProfile({
          capabilities: { chat: false, embeddings: true, detectionSource: "probe" },
        }),
      ],
      indexProfiles: [
        {
          ...createSettings().indexProfiles[0],
          id: "index",
          embeddingModelProfileId: "embedding",
          lastIndexedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    expect(indexSearchEmbedderWarning(settings, translate, "index")).toBeUndefined();
  });
});
