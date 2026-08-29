import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

import {
  applyOnboardingResult,
  capabilityTags,
  hasDuplicateProfileName,
  isValidProfileName,
  cloneIndexProfile,
  createIndexProfile,
  DEFAULT_INDEX_PROFILE,
  normalizeSettingsState,
  DEFAULT_SETTINGS,
  readSettings,
  UNVERIFIED_EMBEDDING_SUSPENSION_REASON,
} from "@adapters/settings";
import type { AttestSettings } from "@adapters/settings";

function freshSettings(): AttestSettings {
  return readSettings(structuredClone(DEFAULT_SETTINGS));
}

const chat = {
  server: {
    name: "OpenAI",
    apiFormat: "openai-compatible" as const,
    baseUrl: "https://api.openai.com/v1/",
    apiKey: "k",
  },
  modelName: "gpt-4.1-mini",
};

const localEmbedding = {
  server: { name: "Ollama", apiFormat: "ollama" as const, baseUrl: "http://localhost:11434" },
  modelName: "nomic-embed-text",
  verified: true,
};

describe("applyOnboardingResult", () => {
  it("creates only a server and chat profile on the web-only route", () => {
    const settings = freshSettings();
    applyOnboardingResult(settings, { scope: "webOnly", chat });

    expect(settings.serverProfiles).toHaveLength(1);
    expect(settings.serverProfiles[0].baseUrl).toBe("https://api.openai.com/v1");
    expect(settings.chatModelProfiles).toHaveLength(1);
    expect(settings.embeddingModelProfiles).toEqual([]);
    expect(settings.newChatDefaults.searchMode).toBe("webOnly");
    expect(settings.newChatDefaults.chatModelProfileId).toBe(settings.chatModelProfiles[0].id);
    expect(settings.onboardingCompleted).toBe(true);
  });

  it("ignores an embedding draft when the scope does not read the vault", () => {
    const settings = freshSettings();
    applyOnboardingResult(settings, {
      scope: "webOnly",
      chat,
      embedding: localEmbedding,
      index: { mode: "wholeVault", includeFolders: ["/"], excludeGlobs: [] },
    });

    expect(settings.embeddingModelProfiles).toEqual([]);
    expect(settings.serverProfiles).toHaveLength(1);
  });

  it("adds a second server profile when the embedding endpoint differs", () => {
    const settings = freshSettings();
    const applied = applyOnboardingResult(settings, {
      scope: "notesAndWeb",
      chat,
      embedding: localEmbedding,
      index: { mode: "wholeVault", includeFolders: ["/"], excludeGlobs: [".obsidian/**"] },
    });

    expect(settings.serverProfiles).toHaveLength(2);
    expect(settings.embeddingModelProfiles[0].serverProfileId).toBe(settings.serverProfiles[1].id);
    expect(applied.embeddingModelProfileId).toBe(settings.embeddingModelProfiles[0].id);
    expect(settings.activeEmbeddingModelProfileId).toBe(settings.embeddingModelProfiles[0].id);
    expect(settings.newChatDefaults.searchMode).toBe("indexAndWeb");
  });

  it("reuses the chat server profile when the embedding endpoint is identical", () => {
    const settings = freshSettings();
    applyOnboardingResult(settings, {
      scope: "notesOnly",
      chat,
      embedding: {
        server: { ...chat.server },
        modelName: "text-embedding-3-small",
        verified: true,
      },
      index: { mode: "wholeVault", includeFolders: ["/"], excludeGlobs: [] },
    });

    expect(settings.serverProfiles).toHaveLength(1);
    expect(settings.embeddingModelProfiles[0].serverProfileId).toBe(settings.serverProfiles[0].id);
  });

  it("suspends an embedding profile whose capability was not verified", () => {
    const settings = freshSettings();
    applyOnboardingResult(settings, {
      scope: "notesOnly",
      chat,
      embedding: { ...localEmbedding, verified: false },
      index: { mode: "wholeVault", includeFolders: ["/"], excludeGlobs: [] },
    });

    const profile = settings.embeddingModelProfiles[0];
    expect(profile.isSuspended).toBe(true);
    expect(profile.suspendedReason).toBe(UNVERIFIED_EMBEDDING_SUSPENSION_REASON);
    expect(profile.capabilities?.embeddings).toBe(false);
  });

  it("creates the index profile only on a route that asked for the vault", () => {
    const settings = freshSettings();
    expect(settings.indexProfiles).toHaveLength(0);
    const applied = applyOnboardingResult(settings, {
      scope: "notesOnly",
      chat,
      embedding: localEmbedding,
      index: {
        mode: "selected",
        indexFolder: "Data/attest-index",
        includeFolders: ["Projects", "Notes"],
        excludeGlobs: [".obsidian/**"],
      },
    });

    expect(settings.indexProfiles).toHaveLength(1);
    const profile = settings.indexProfiles[0];
    expect(applied.indexProfileId).toBe(profile.id);
    expect(profile.isSuspended).toBe(false);
    expect(profile.suspendedReason).toBeUndefined();
    expect(profile.mode).toBe("selected");
    expect(profile.indexFolder).toBe("Data/attest-index");
    expect(profile.includeFolders).toEqual(["Projects", "Notes"]);
    expect(profile.excludeGlobs).toEqual([]);
    expect(profile.embeddingModelProfileId).toBe(settings.embeddingModelProfiles[0].id);
    expect(settings.newChatDefaults.indexProfileId).toBe(profile.id);
  });

  it("keeps the exclusion globs for a whole-vault index", () => {
    const settings = freshSettings();
    applyOnboardingResult(settings, {
      scope: "notesOnly",
      chat,
      embedding: localEmbedding,
      index: { mode: "wholeVault", includeFolders: ["ignored"], excludeGlobs: [".obsidian/**"] },
    });

    expect(settings.indexProfiles[0].includeFolders).toEqual(["/"]);
    expect(settings.indexProfiles[0].excludeGlobs).toEqual([".obsidian/**"]);
  });

  it("does not share the caller's folder array with the stored profile", () => {
    const settings = freshSettings();
    const includeFolders = ["Projects"];
    applyOnboardingResult(settings, {
      scope: "notesOnly",
      chat,
      embedding: localEmbedding,
      index: { mode: "selected", includeFolders, excludeGlobs: [] },
    });
    includeFolders.push("Leaked");

    expect(settings.indexProfiles[0].includeFolders).toEqual(["Projects"]);
  });

  it("survives a settings object whose default index profile was deleted", () => {
    const settings = freshSettings();
    settings.indexProfiles = [];
    const applied = applyOnboardingResult(settings, {
      scope: "notesOnly",
      chat,
      embedding: localEmbedding,
      index: { mode: "wholeVault", includeFolders: ["/"], excludeGlobs: [] },
    });

    expect(settings.indexProfiles).toHaveLength(1);
    expect(applied.indexProfileId).toBe(settings.indexProfiles[0].id);
  });
});

describe("onboarding persistence", () => {
  it("treats a vault saved before the wizard existed as not yet onboarded", () => {
    const legacy = structuredClone(DEFAULT_SETTINGS) as Partial<AttestSettings>;
    delete legacy.onboardingCompleted;

    expect(readSettings(legacy).onboardingCompleted).toBe(false);
  });

  it("keeps a completed wizard completed across a reload", () => {
    const settings = freshSettings();
    applyOnboardingResult(settings, { scope: "webOnly", chat });

    expect(readSettings(structuredClone(settings)).onboardingCompleted).toBe(true);
  });

  it("rejects a non-boolean flag from saved data", () => {
    const tampered = { ...structuredClone(DEFAULT_SETTINGS), onboardingCompleted: "yes" };

    expect(readSettings(tampered).onboardingCompleted).toBe(false);
  });
  it("survives the normalization the plugin runs on every save", () => {
    const settings = freshSettings();
    const applied = applyOnboardingResult(settings, {
      scope: "notesAndWeb",
      chat,
      embedding: localEmbedding,
      index: { mode: "wholeVault", includeFolders: ["/"], excludeGlobs: [".obsidian/**"] },
    });

    normalizeSettingsState(settings);

    const profile = settings.indexProfiles.find(
      (candidate) => candidate.id === applied.indexProfileId,
    )!;
    expect(profile.isSuspended).toBe(false);
    expect(profile.embeddingModelProfileId).toBe(applied.embeddingModelProfileId);
    expect(settings.onboardingCompleted).toBe(true);
    expect(settings.newChatDefaults.searchMode).toBe("indexAndWeb");
    expect(settings.newChatDefaults.chatModelProfileId).toBe(applied.chatModelProfileId);
    expect(settings.newChatDefaults.indexProfileId).toBe(applied.indexProfileId);
  });
  it("names generated profiles after the model, readably and within the length limit", () => {
    const settings = freshSettings();
    applyOnboardingResult(settings, {
      scope: "notesOnly",
      chat: { ...chat, modelName: "meta-llama/llama-3.1-70b-instruct" },
      embedding: {
        ...localEmbedding,
        modelName: "sentence-transformers/all-mpnet-base-v2-with-a-very-long-suffix",
      },
      index: { mode: "wholeVault", includeFolders: ["/"], excludeGlobs: [] },
    });

    const chatProfile = settings.chatModelProfiles[0];
    const embeddingProfile = settings.embeddingModelProfiles[0];
    expect(isValidProfileName(chatProfile.name)).toBe(true);
    expect(isValidProfileName(embeddingProfile.name)).toBe(true);
    expect(isValidProfileName(settings.serverProfiles[0].name)).toBe(true);
    expect(chatProfile.name).toBe("Llama 3.1 70B Instruct");
    expect(chatProfile.modelName).toBe("meta-llama/llama-3.1-70b-instruct");
    expect(embeddingProfile.modelName).toBe(
      "sentence-transformers/all-mpnet-base-v2-with-a-very-long-suffix",
    );
  });
  it("leaves a fresh vault with no index profile at all", () => {
    expect(DEFAULT_SETTINGS.indexProfiles).toEqual([]);
    expect(readSettings(undefined).indexProfiles).toEqual([]);
    expect(freshSettings().indexProfiles).toEqual([]);
  });

  it("creates no index profile on the web-only route", () => {
    const settings = freshSettings();

    applyOnboardingResult(settings, { scope: "webOnly", chat });

    expect(settings.indexProfiles).toEqual([]);
    expect(settings.newChatDefaults.indexProfileId).toBe("");
  });

  it("creates no index profile when the vault route is abandoned before the folders step", () => {
    const settings = freshSettings();

    applyOnboardingResult(settings, { scope: "notesOnly", chat, embedding: localEmbedding });

    expect(settings.indexProfiles).toEqual([]);
    expect(settings.embeddingModelProfiles).toHaveLength(1);
  });
  it("builds the first index as a rebuild so it is not left flagged for reindexing", () => {
    const source = readFileSync(resolve("src/apps/obsidian/main.ts"), "utf8");
    const wizardStart = source.slice(source.indexOf("onStartIndexing:"));

    expect(wizardStart.slice(0, wizardStart.indexOf("},"))).toContain('mode: "rebuild"');
  });
  it("edits the profiles the first run created instead of adding a second set", () => {
    const settings = freshSettings();
    const first = applyOnboardingResult(settings, { scope: "webOnly", chat });

    const second = applyOnboardingResult(settings, {
      scope: "webOnly",
      chat: { ...chat, modelName: "gpt-4.1" },
    });

    expect(settings.serverProfiles).toHaveLength(1);
    expect(settings.chatModelProfiles).toHaveLength(1);
    expect(second.chatModelProfileId).toBe(first.chatModelProfileId);
    expect(settings.chatModelProfiles[0].modelName).toBe("gpt-4.1");
    expect(settings.newChatDefaults.chatModelProfileId).toBe(second.chatModelProfileId);
  });

  it("edits the embedding and index profiles of the first run as well", () => {
    const settings = freshSettings();
    const first = applyOnboardingResult(settings, {
      scope: "notesAndWeb",
      chat,
      embedding: localEmbedding,
      index: { mode: "wholeVault", includeFolders: ["/"], excludeGlobs: [".trash/**"] },
    });

    const second = applyOnboardingResult(settings, {
      scope: "notesAndWeb",
      chat,
      embedding: { ...localEmbedding, modelName: "mxbai-embed-large" },
      index: { mode: "selected", includeFolders: ["Notes"], excludeGlobs: [] },
    });

    expect(settings.serverProfiles).toHaveLength(2);
    expect(settings.embeddingModelProfiles).toHaveLength(1);
    expect(settings.indexProfiles).toHaveLength(1);
    expect(second.embeddingModelProfileId).toBe(first.embeddingModelProfileId);
    expect(second.indexProfileId).toBe(first.indexProfileId);
    expect(settings.embeddingModelProfiles[0].modelName).toBe("mxbai-embed-large");
    expect(settings.indexProfiles[0].mode).toBe("selected");
    expect(settings.indexProfiles[0].includeFolders).toEqual(["Notes"]);
  });

  it("records the ids of the profiles it created so a later run can find them", () => {
    const settings = freshSettings();
    const applied = applyOnboardingResult(settings, {
      scope: "notesAndWeb",
      chat,
      embedding: localEmbedding,
      index: { mode: "wholeVault", includeFolders: ["/"], excludeGlobs: [] },
    });

    expect(settings.onboardingProfileIds).toEqual({
      chatServerProfileId: settings.serverProfiles[0].id,
      chatModelProfileId: applied.chatModelProfileId,
      embeddingServerProfileId: settings.serverProfiles[1].id,
      embeddingModelProfileId: applied.embeddingModelProfileId,
      indexProfileId: applied.indexProfileId,
    });
  });

  it("survives saved data whose recorded ids are missing or malformed", () => {
    const saved = structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>;
    saved.onboardingProfileIds = { chatModelProfileId: 7, indexProfileId: null };
    const settings = readSettings(saved);

    expect(settings.onboardingProfileIds.chatModelProfileId).toBe("");
    expect(() => applyOnboardingResult(settings, { scope: "webOnly", chat })).not.toThrow();
    expect(settings.chatModelProfiles).toHaveLength(1);
  });

  it("drops the separate embedding server once both models move onto one endpoint", () => {
    const settings = freshSettings();
    applyOnboardingResult(settings, {
      scope: "notesAndWeb",
      chat,
      embedding: localEmbedding,
      index: { mode: "wholeVault", includeFolders: ["/"], excludeGlobs: [] },
    });
    expect(settings.serverProfiles).toHaveLength(2);

    applyOnboardingResult(settings, {
      scope: "notesAndWeb",
      chat,
      embedding: { ...localEmbedding, server: chat.server },
      index: { mode: "wholeVault", includeFolders: ["/"], excludeGlobs: [] },
    });

    expect(settings.serverProfiles).toHaveLength(1);
    expect(settings.embeddingModelProfiles[0].serverProfileId).toBe(settings.serverProfiles[0].id);
  });

  it("keeps an embedding server a hand-made profile still points at", () => {
    const settings = freshSettings();
    applyOnboardingResult(settings, {
      scope: "notesAndWeb",
      chat,
      embedding: localEmbedding,
      index: { mode: "wholeVault", includeFolders: ["/"], excludeGlobs: [] },
    });
    const embeddingServerId = settings.serverProfiles[1].id;
    settings.chatModelProfiles.push({
      ...settings.chatModelProfiles[0],
      id: "hand-made",
      name: "Hand made",
      serverProfileId: embeddingServerId,
    });

    applyOnboardingResult(settings, {
      scope: "notesAndWeb",
      chat,
      embedding: { ...localEmbedding, server: chat.server },
      index: { mode: "wholeVault", includeFolders: ["/"], excludeGlobs: [] },
    });

    expect(settings.serverProfiles.map((profile) => profile.id)).toContain(embeddingServerId);
  });

  it("keeps a generated name unique against a profile the user made by hand", () => {
    const settings = freshSettings();
    applyOnboardingResult(settings, { scope: "webOnly", chat });
    settings.chatModelProfiles.push({
      ...settings.chatModelProfiles[0],
      id: "hand-made",
      name: "GPT 4.1",
    });

    applyOnboardingResult(settings, {
      scope: "webOnly",
      chat: { ...chat, modelName: "gpt-4.1" },
    });

    const wizardProfile = settings.chatModelProfiles.find(
      (profile) => profile.id === settings.onboardingProfileIds.chatModelProfileId,
    );
    expect(wizardProfile?.name).not.toBe("GPT 4.1");
    expect(isValidProfileName(wizardProfile?.name ?? "")).toBe(true);
    expect(
      hasDuplicateProfileName(
        settings.chatModelProfiles,
        wizardProfile?.name ?? "",
        wizardProfile?.id,
      ),
    ).toBe(false);
  });

  it("keeps a suffixed name inside the length the settings screens accept", () => {
    const settings = freshSettings();
    applyOnboardingResult(settings, { scope: "webOnly", chat });
    const longModel = "vendor/an-extremely-long-embedding-model-name";
    applyOnboardingResult(settings, { scope: "webOnly", chat: { ...chat, modelName: longModel } });
    settings.chatModelProfiles.push({
      ...settings.chatModelProfiles[0],
      id: "hand-made",
      name: settings.chatModelProfiles[0].name,
    });

    applyOnboardingResult(settings, { scope: "webOnly", chat });
    applyOnboardingResult(settings, { scope: "webOnly", chat: { ...chat, modelName: longModel } });

    const names = settings.chatModelProfiles.map((profile) => profile.name);
    expect(new Set(names).size).toBe(2);
    expect(names.every((name) => isValidProfileName(name))).toBe(true);
  });

  it("keeps a renamed profile and its probed capabilities when the model is unchanged", () => {
    const settings = freshSettings();
    applyOnboardingResult(settings, { scope: "webOnly", chat });
    const profile = settings.chatModelProfiles[0];
    profile.name = "Work chat";
    profile.capabilities = { chat: true, embeddings: false, detectionSource: "probe" };
    settings.serverProfiles[0].name = "Work server";

    applyOnboardingResult(settings, {
      scope: "webOnly",
      chat: { ...chat, server: { ...chat.server, name: "Work server" } },
    });

    expect(settings.chatModelProfiles[0].name).toBe("Work chat");
    expect(settings.chatModelProfiles[0].capabilities?.detectionSource).toBe("probe");
    expect(settings.serverProfiles[0].name).toBe("Work server");
  });

  it("leaves an index profile the wizard did not create untouched", () => {
    const settings = freshSettings();
    settings.indexProfiles = [
      createIndexProfile({
        id: "default",
        name: "My index",
        mode: "selected",
        indexFolder: ".attest/index",
        includeFolders: ["Research"],
        excludeGlobs: ["Archive/**"],
      }),
    ];

    applyOnboardingResult(settings, {
      scope: "notesAndWeb",
      chat,
      embedding: localEmbedding,
      index: { mode: "wholeVault", includeFolders: ["/"], excludeGlobs: [] },
    });

    const untouched = settings.indexProfiles.find((entry) => entry.id === "default");
    expect(untouched?.mode).toBe("selected");
    expect(untouched?.includeFolders).toEqual(["Research"]);
    expect(settings.indexProfiles).toHaveLength(2);
    expect(settings.onboardingProfileIds.indexProfileId).not.toBe("default");
    for (const profile of settings.indexProfiles) {
      expect(hasDuplicateProfileName(settings.indexProfiles, profile.name, profile.id)).toBe(false);
    }
  });

  it("does not clash with the seeded index profile name a legacy vault still carries", () => {
    const settings = freshSettings();
    settings.indexProfiles = [cloneIndexProfile(DEFAULT_INDEX_PROFILE)];

    applyOnboardingResult(settings, {
      scope: "notesAndWeb",
      chat,
      embedding: localEmbedding,
      index: { mode: "wholeVault", includeFolders: ["/"], excludeGlobs: [] },
    });

    expect(settings.indexProfiles).toHaveLength(2);
    for (const profile of settings.indexProfiles) {
      expect(hasDuplicateProfileName(settings.indexProfiles, profile.name, profile.id)).toBe(false);
      expect(isValidProfileName(profile.name)).toBe(true);
    }
  });

  it("keeps the vault profiles when a later run narrows the scope to the web", () => {
    const settings = freshSettings();
    const first = applyOnboardingResult(settings, {
      scope: "notesAndWeb",
      chat,
      embedding: localEmbedding,
      index: { mode: "wholeVault", includeFolders: ["/"], excludeGlobs: [] },
    });

    applyOnboardingResult(settings, { scope: "webOnly", chat });

    expect(settings.newChatDefaults.searchMode).toBe("webOnly");
    expect(settings.embeddingModelProfiles).toHaveLength(1);
    expect(settings.indexProfiles).toHaveLength(1);
    expect(settings.activeEmbeddingModelProfileId).toBe(first.embeddingModelProfileId);
    expect(settings.onboardingProfileIds.indexProfileId).toBe(first.indexProfileId);
  });

  it("carries the advertised tool and reasoning capabilities into the chat profile", () => {
    const settings = freshSettings();

    applyOnboardingResult(settings, {
      scope: "webOnly",
      chat: {
        ...chat,
        capabilities: { chat: true, embeddings: false, tools: true, detectionSource: "metadata" },
        capabilitySnapshot: {
          checkedAt: "2026-01-01T00:00:00.000Z",
          tools: "supported",
          toolControls: { choiceRequired: true, choiceSpecific: true, parallelCalls: false },
          protocols: { responses: "supported", chatCompletions: "supported" },
          reasoning: { defaultEffort: "medium" },
          continuation: "supported",
          summary: "supported",
        } as never,
      },
    });

    const profile = settings.chatModelProfiles[0];
    expect(capabilityTags(profile)).toEqual(["Agent", "Tools"]);
    expect(profile.capabilities?.toolCalling?.advertised?.calls).toBe(true);
    expect(profile.capabilities?.toolCalling?.advertised?.choiceRequired).toBe(true);
    expect(profile.reasoningCapabilities?.source).toBe("metadata");
    expect(profile.reasoning.effort).toBe("medium");
    expect(profile.reasoning.summary).toBe("auto");
  });

  it("claims no capability for a model whose provider advertises none", () => {
    const settings = freshSettings();

    applyOnboardingResult(settings, { scope: "webOnly", chat });

    const profile = settings.chatModelProfiles[0];
    expect(capabilityTags(profile)).toEqual(["Instant"]);
    expect(profile.reasoningCapabilities).toBeUndefined();
    expect(profile.reasoning.summary).toBe("off");
  });
});
