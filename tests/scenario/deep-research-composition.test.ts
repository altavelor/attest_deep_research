import { describe, expect, it, vi } from "vitest";

const edges = vi.hoisted(() => ({ model: null as unknown, rounds: null as unknown }));

vi.mock("@apps/obsidian/composition/modelClientFactory", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createChatModelClient: () => edges.model,
  createResponsesRoundProvider: () => edges.rounds,
}));

vi.mock("@apps/obsidian/composition/indexingFactory", async (importOriginal) => {
  const { FakeRetriever } = await import("../support/researchFakes");
  const { markdownSource, retrieved } = await import("../support/factories");
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    createRetrieverForProfile: () =>
      new FakeRetriever({
        chunks: [
          retrieved("chunk-tides-1", markdownSource("Notes/tides.md"), "The moon causes tides."),
        ],
        citations: [],
        usedFallback: false,
      }),
    createContextExtractorsForProfile: () => [],
    createVectorIndexStoreForProfile: () => ({}),
  };
});

vi.mock("@apps/obsidian/composition/webSearchFactory", () => ({
  createWebSearchProvider: () => undefined,
}));

import { DEFAULT_INDEX_PROFILE, DEFAULT_SETTINGS } from "@adapters/settings";
import { createTranslator } from "@adapters/i18n";
import type { ResearchRequest } from "@application/contracts/research";
import {
  createResearchService,
  type CompositionContext,
} from "@apps/obsidian/composition/factories";
import type { SavedChatSettings } from "@core/chat/savedChat";
import { collectAsync } from "../support/async";
import { realSubAgentChat, startResearchTurn } from "../support/chatSubAgentWiring";
import {
  BranchModelRounds,
  CitingReportModel,
  MemoryResearchState,
  ResearchRegistry,
  gatheringResearch,
  researchBranch,
  researchPlan,
} from "../support/deepResearch";
import { MemoryFileSystem } from "../support/memoryFileSystem";
import { App } from "../support/obsidian";

const SETTINGS: SavedChatSettings = {
  chatModelProfileId: "chat",
  searchMode: "indexOnly",
  researchMode: "deep-research",
};

function composedContext(): CompositionContext {
  const timestamp = "2026-01-01T00:00:00.000Z";
  const settings = {
    ...DEFAULT_SETTINGS,
    deepResearchPreview: true,
    serverProfiles: [
      {
        id: "server",
        name: "Server",
        apiFormat: "openai-compatible" as const,
        baseUrl: "http://localhost:1234/v1",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    chatModelProfiles: [
      {
        id: "chat",
        name: "Chat",
        serverProfileId: "server",
        modelName: "chat-model",
        toolsEnabled: true,
        noteMutationAccess: false,
        reasoning: { mode: "off" as const, summary: "off" as const },
        capabilities: {
          toolCalling: {
            formatDefault: {
              calls: true,
              choiceRequired: true,
              choiceSpecific: true,
              parallelCalls: false,
            },
          },
        },
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    embeddingModelProfiles: [
      {
        id: "embedding",
        name: "Embedding",
        serverProfileId: "server",
        modelName: "embed-model",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    indexProfiles: [
      {
        ...DEFAULT_INDEX_PROFILE,
        embeddingModelProfileId: "embedding",
        isSuspended: false,
        lastIndexedAt: timestamp,
      },
    ],
    newChatDefaults: { ...DEFAULT_SETTINGS.newChatDefaults, chatModelProfileId: "chat" },
  };
  const app = new App();
  return {
    app,
    logger: {
      logError: vi.fn(),
      logRequest: vi.fn(),
      logResponse: vi.fn(),
      logIndexingFile: vi.fn(),
      logIndexingPerformance: vi.fn(),
      logSubAgent: vi.fn(),
    },
    translator: createTranslator("en"),
    pdfTextCache: {},
    webSourceHealth: { getIssue: vi.fn() },
    warmCaches: {
      contextFiles: () => ({ listPaths: async () => [], readFile: async () => "" }),
      languageInventory: () => ({ getLanguageInventory: async () => [] }),
    },
    fileSystem: {},
    getSettings: () => settings,
    saveSettings: async () => {},
    getIndexingState: () => ({ status: "idle", indexedFiles: 1, isStale: false }),
  } as unknown as CompositionContext;
}

async function composedRun(request: Partial<ResearchRequest> = {}) {
  const registry = new ResearchRegistry();
  const rounds = new BranchModelRounds();
  edges.model = new CitingReportModel();
  edges.rounds = rounds;
  const gathering = gatheringResearch(
    researchPlan([researchBranch(1), researchBranch(2), researchBranch(3)], "balanced"),
  );
  const state = {
    ...gathering,
    plan: { ...gathering.plan!, approvedAt: new Date().toISOString() },
  };
  const port = new MemoryResearchState();
  port.commits.push(state);
  const service = createResearchService(composedContext(), "chat", undefined, "indexOnly");
  await collectAsync(
    service.answer({
      question: "Continue",
      searchMode: "indexOnly",
      finalizeAnswer: registry.finalizeAnswer,
      resolveEvidence: registry.resolveEvidence,
      ...request,
      mode: "deep-research",
      research: { type: "continue", researchId: state.researchId },
      researchState: port,
    }),
  );
  const final = port.commits.at(-1)!;
  return { report: final.report, sessions: Object.keys(final.sessionByBranch), rounds };
}

describe("deep research through the composition factory", () => {
  it("runs on the main path without a manager and in child sessions one round at a time with one", async () => {
    const mainPath = await composedRun();
    expect(mainPath.report?.completedBranches).toHaveLength(3);
    expect(mainPath.sessions).toEqual([]);

    const parent = async () => {
      const chat = realSubAgentChat(new MemoryFileSystem());
      const session = chat.manager.createSession(SETTINGS);
      const { request } = await startResearchTurn(chat, session.sessionId, "research-1");
      return request;
    };
    const sequential = await composedRun(await parent());
    expect(sequential.report?.completedBranches).toHaveLength(3);
    expect(sequential.sessions).toHaveLength(3);
    expect(sequential.rounds.peakConcurrentRounds).toBe(1);
  });
});
