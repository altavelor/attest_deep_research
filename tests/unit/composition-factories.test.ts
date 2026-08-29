import { describe, expect, it, vi } from "vitest";

const { createWebSearchProvider, researchServiceOptions } = vi.hoisted(() => ({
  createWebSearchProvider: vi.fn(),
  researchServiceOptions: [] as Record<string, unknown>[],
}));

vi.mock("@apps/obsidian/composition/webSearchFactory", () => ({ createWebSearchProvider }));

vi.mock("@application/use-cases/research", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ResearchService: class {
    constructor(options: Record<string, unknown>) {
      researchServiceOptions.push(options);
    }
  },
}));

import { DEFAULT_SETTINGS, DEFAULT_INDEX_PROFILE } from "@adapters/settings";
import type { CompositionContext } from "@apps/obsidian/composition/factories";
import { createResearchService, createSearchProvider } from "@apps/obsidian/composition/factories";
import { createTranslator } from "@adapters/i18n";

describe("composition factories", () => {
  it("passes settings and shared infrastructure into the web-search factory", () => {
    const settings = { ...DEFAULT_SETTINGS };
    const logger = { logError: vi.fn() };
    const health = { getIssue: vi.fn() };
    const provider = { search: vi.fn() };
    const intentClassifier = { classify: vi.fn() };
    createWebSearchProvider.mockReturnValue(provider);
    const ctx = {
      getSettings: () => settings,
      logger,
      webSourceHealth: health,
    } as unknown as CompositionContext;

    expect(createSearchProvider(ctx, intentClassifier)).toBe(provider);
    expect(createWebSearchProvider).toHaveBeenCalledWith({
      settings,
      logger,
      health,
      intentClassifier,
    });
  });
});

describe("research service composition", () => {
  const chatProfile = {
    id: "chat",
    name: "Chat",
    serverProfileId: "server",
    modelName: "chat-model",
    toolsEnabled: false,
    noteMutationAccess: false,
    reasoning: { mode: "off" as const, summary: "off" as const },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const serverProfile = {
    id: "server",
    name: "Server",
    apiFormat: "openai-compatible" as const,
    baseUrl: "http://localhost:1234/v1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  const embeddingProfile = {
    id: "embedding",
    name: "Embedding",
    serverProfileId: "server",
    modelName: "embed-model",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  function createContext(indexed = false): CompositionContext {
    const settings = {
      ...DEFAULT_SETTINGS,
      serverProfiles: [serverProfile],
      chatModelProfiles: [chatProfile],
      embeddingModelProfiles: indexed ? [embeddingProfile] : [],
      expandSearchQuery: true,
      indexProfiles: [DEFAULT_INDEX_PROFILE].map((profile) => ({
        ...profile,
        embeddingModelProfileId: "embedding",
        ...(indexed ? { isSuspended: false, lastIndexedAt: "2026-01-01T00:00:00.000Z" } : {}),
      })),
      newChatDefaults: { ...DEFAULT_SETTINGS.newChatDefaults, chatModelProfileId: "chat" },
    };

    return {
      app: { vault: {}, metadataCache: {}, workspace: {} },
      logger: {
        logError: vi.fn(),
        logRequest: vi.fn(),
        logResponse: vi.fn(),
        logIndexingPerformance: vi.fn(),
      },
      translator: createTranslator("en"),
      pdfTextCache: {},
      webSourceHealth: { getIssue: vi.fn() },
      warmCaches: {
        contextFiles: () => ({}),
        languageInventory: () => ({ getLanguageInventory: async () => [] }),
      },
      fileSystem: {},
      getSettings: () => settings,
      saveSettings: async () => {},
      getIndexingState: () => ({ status: "idle", indexedFiles: 0, isStale: false }),
    } as unknown as CompositionContext;
  }

  function composedOptions(
    ctx: CompositionContext,
    searchMode?: Parameters<typeof createResearchService>[3],
  ): Record<string, unknown> {
    researchServiceOptions.length = 0;
    createWebSearchProvider.mockReturnValue({ search: vi.fn() });
    createResearchService(ctx, "chat", undefined, searchMode);
    return researchServiceOptions.at(-1)!;
  }

  it("composes a web-only turn without a built index", () => {
    createWebSearchProvider.mockReturnValue({ search: vi.fn() });

    expect(() =>
      createResearchService(createContext(), "chat", undefined, "webOnly"),
    ).not.toThrow();
    expect(() => createResearchService(createContext(), "chat", undefined, "none")).not.toThrow();
  });

  it("still requires a built index for a turn that reads the vault", () => {
    createWebSearchProvider.mockReturnValue({ search: vi.fn() });

    expect(() => createResearchService(createContext(), "chat", undefined, "indexAndWeb")).toThrow(
      "Index this profile before using it in chat or search.",
    );
    expect(() => createResearchService(createContext(), "chat")).toThrow(
      "Index this profile before using it in chat or search.",
    );
  });

  it("keeps every index-backed collaborator for a turn that reads the vault", () => {
    const options = composedOptions(createContext(true), "indexAndWeb");

    expect(options.retriever).toBeDefined();
    expect(options.queryExpansion).toBeDefined();
    expect(options.documentImageCandidates).toBeDefined();
    expect(options.indexDescription).toBeDefined();
    expect(options.contextAssembler).toBeDefined();
  });

  it("omits index-backed collaborators from a web-only turn but still reports index status", () => {
    const options = composedOptions(createContext(true), "webOnly");

    expect(options.retriever).toBeUndefined();
    expect(options.queryExpansion).toBeUndefined();
    expect(options.documentImageCandidates).toBeUndefined();
    expect(options.indexDescription).toBeUndefined();
    expect(options.contextAssembler).toBeDefined();
    expect((options.getIndexStatus as () => unknown)()).toMatchObject({
      status: "idle",
      available: true,
    });
  });

  it("composes attached-source context when the vault has no index profile at all", () => {
    const ctx = createContext();
    const settings = ctx.getSettings() as { indexProfiles: unknown[] };
    settings.indexProfiles = [];

    const options = composedOptions(ctx, "none");

    expect(options.contextAssembler).toBeDefined();
    expect(options.retriever).toBeUndefined();
  });

  it("reports index status for a turn composed without a built index", () => {
    const options = composedOptions(createContext(), "none");

    expect((options.getIndexStatus as () => unknown)()).toMatchObject({ available: false });
  });
});
