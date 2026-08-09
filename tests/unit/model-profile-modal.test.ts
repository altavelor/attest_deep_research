// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, takeNotices } from "../stubs/obsidian";

import { createTranslator } from "@adapters/i18n";
import type {
  ChatModelProfile,
  DiscoveredModel,
  EmbeddingModelProfile,
  ServerProfile,
} from "@adapters/settings";
import { ModelProfileModal } from "@apps/obsidian/ui/settings/ModelProfileModal";
import type { App as ObsidianApp } from "obsidian";
import {
  installObsidianDomHelpers,
  resetDom,
  restoreDomTimers,
  useDomFakeTimers,
} from "../helpers/domHarness";

const t = createTranslator("en").t;

const server: ServerProfile = {
  id: "server",
  name: "Server",
  apiFormat: "openai-compatible",
  baseUrl: "https://models.example/v1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const model: DiscoveredModel = {
  id: "chat-model",
  name: "chat-model",
  capabilities: {
    chat: true,
    embeddings: false,
    contextLength: 32_000,
    detectionSource: "metadata",
  },
};

function inputFor(container: HTMLElement, name: string): HTMLInputElement {
  const setting = Array.from(container.querySelectorAll(".setting-item")).find(
    (item) => item.firstElementChild?.textContent === name,
  );
  expect(setting).toBeDefined();
  const input = setting!.querySelector<HTMLInputElement>("input");
  expect(input).not.toBeNull();
  return input!;
}

describe("ModelProfileModal", () => {
  beforeEach(() => {
    installObsidianDomHelpers();
    useDomFakeTimers();
  });

  afterEach(() => {
    restoreDomTimers();
    resetDom();
    vi.restoreAllMocks();
  });

  it("saves a discovered chat model with its detected context length", async () => {
    const onSave = vi.fn(async () => {});
    const modal = new ModelProfileModal<ChatModelProfile>(new App() as unknown as ObsidianApp, {
      t,
      kind: "chat",
      servers: [server],
      profiles: [],
      fetchedModelsByServerId: new Map([[server.id, [model]]]),
      fetchModels: vi.fn(async () => [model]),
      onSave,
    });
    modal.open();

    inputFor(modal.contentEl, "Name").value = "Primary chat";
    inputFor(modal.contentEl, "Name").dispatchEvent(new Event("input"));
    const modelInput = inputFor(modal.contentEl, "Model");
    modelInput.focus();
    modelInput.dispatchEvent(new Event("focus"));
    const option = modal.contentEl.querySelector<HTMLButtonElement>(
      '.ixplorer-profile-modal__model-option[role="option"]',
    );
    expect(option?.textContent).toBe("chat-model");
    option!.click();
    await vi.waitFor(() => expect(inputFor(modal.contentEl, "Context size").value).toBe("32000"));

    const buttons = Array.from(modal.contentEl.querySelectorAll<HTMLButtonElement>("button"));
    buttons.find((button) => button.textContent === "Save")!.click();

    await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Primary chat",
        serverProfileId: "server",
        modelName: "chat-model",
        capabilities: expect.objectContaining({ chat: true, contextLength: 32_000 }),
        toolsEnabled: false,
      }),
    );
  });

  it("saves an embedding profile without chat-only settings", async () => {
    const embedding: DiscoveredModel = {
      id: "embedding-model",
      name: "embedding-model",
      capabilities: { chat: false, embeddings: true, detectionSource: "probe" },
    };
    let saved: EmbeddingModelProfile | undefined;
    const onSave = vi.fn(async (profile: EmbeddingModelProfile) => {
      saved = profile;
    });
    const modal = new ModelProfileModal<EmbeddingModelProfile>(
      new App() as unknown as ObsidianApp,
      {
        t,
        kind: "embedding",
        servers: [server],
        profiles: [],
        fetchedModelsByServerId: new Map([[server.id, [embedding]]]),
        fetchModels: vi.fn(async () => [embedding]),
        onSave,
      },
    );
    modal.open();

    const name = inputFor(modal.contentEl, "Name");
    name.value = "Embedding";
    name.dispatchEvent(new Event("input"));
    const modelInput = inputFor(modal.contentEl, "Model");
    modelInput.focus();
    modelInput.dispatchEvent(new Event("focus"));
    modal.contentEl
      .querySelector<HTMLButtonElement>('.ixplorer-profile-modal__model-option[role="option"]')!
      .click();
    Array.from(modal.contentEl.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Save")!
      .click();

    await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Embedding",
        modelName: "embedding-model",
        capabilities: expect.objectContaining({ chat: false, embeddings: true }),
      }),
    );
    expect(saved).not.toHaveProperty("reasoning");
  });

  it("blocks new profiles with unknown models and suspended servers", () => {
    const onSave = vi.fn(async () => {});
    const modal = new ModelProfileModal<ChatModelProfile>(new App() as unknown as ObsidianApp, {
      t,
      kind: "chat",
      servers: [server],
      profiles: [],
      fetchedModelsByServerId: new Map(),
      fetchModels: vi.fn(async () => []),
      onSave,
    });
    modal.open();
    const name = inputFor(modal.contentEl, "Name");
    name.value = "Chat";
    name.dispatchEvent(new Event("input"));
    const modelInput = inputFor(modal.contentEl, "Model");
    modelInput.value = "missing-model";
    modelInput.dispatchEvent(new Event("input"));
    Array.from(modal.contentEl.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Save")!
      .click();
    expect(takeNotices()[0]?.message).toContain("Fetch models before creating a model profile.");

    const suspendedServer = { ...server, isSuspended: true };
    const suspended = new ModelProfileModal<ChatModelProfile>(new App() as unknown as ObsidianApp, {
      t,
      kind: "chat",
      servers: [suspendedServer],
      profiles: [],
      fetchedModelsByServerId: new Map([[suspendedServer.id, [model]]]),
      fetchModels: vi.fn(async () => [model]),
      onSave,
    });
    suspended.open();
    expect(
      Array.from(suspended.contentEl.querySelectorAll<HTMLSelectElement>("select"))[0]?.value,
    ).toBe("");
    Array.from(suspended.contentEl.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Save")!
      .click();
    expect(takeNotices()[0]?.message).toBe("Fill all required fields.");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("edits an existing verified chat profile while preserving probe capabilities", async () => {
    const profile: ChatModelProfile = {
      id: "chat-existing",
      name: "Existing chat",
      serverProfileId: server.id,
      modelName: model.name,
      toolsEnabled: true,
      noteMutationAccess: true,
      temperature: 0.3,
      maxTokens: 2048,
      reasoning: { mode: "on", effort: "low", summary: "auto" },
      reasoningCapabilities: {
        source: "probe",
        responses: true,
        continuation: true,
        summary: true,
        efforts: ["low", "high"],
      },
      capabilities: {
        chat: true,
        embeddings: false,
        temperature: true,
        maxTokens: true,
        contextLength: 16_000,
        detectionSource: "probe",
        toolCalling: {
          formatDefault: {
            calls: true,
            choiceRequired: true,
            choiceSpecific: true,
            parallelCalls: true,
          },
          probe: { calls: true, choiceRequired: true, choiceSpecific: true, parallelCalls: true },
        },
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const onSave = vi.fn(async () => {});
    const modal = new ModelProfileModal<ChatModelProfile>(new App() as unknown as ObsidianApp, {
      t,
      kind: "chat",
      profile,
      servers: [server],
      profiles: [profile],
      fetchedModelsByServerId: new Map([[server.id, [model]]]),
      fetchModels: vi.fn(async () => [model]),
      onSave,
      resolveProfile: (id) => (id === profile.id ? profile : undefined),
    });
    modal.open();

    expect(inputFor(modal.contentEl, "Temperature").value).toBe("0.3");
    expect(inputFor(modal.contentEl, "Max tokens").value).toBe("2048");
    expect(inputFor(modal.contentEl, "Context size").value).toBe("16000");
    inputFor(modal.contentEl, "Temperature").value = "0.7";
    inputFor(modal.contentEl, "Temperature").dispatchEvent(new Event("input"));
    inputFor(modal.contentEl, "Max tokens").value = "4096";
    inputFor(modal.contentEl, "Max tokens").dispatchEvent(new Event("input"));
    Array.from(modal.contentEl.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Save")!
      .click();

    await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        id: profile.id,
        toolsEnabled: true,
        noteMutationAccess: true,
        temperature: 0.7,
        maxTokens: 4096,
        reasoning: { mode: "on", effort: "low", summary: "auto" },
        reasoningCapabilities: profile.reasoningCapabilities,
        capabilities: expect.objectContaining({
          contextLength: 16_000,
          detectionSource: "metadata",
        }),
      }),
    );
  });

  it("edits a legacy chat profile with unset optional model controls", async () => {
    const profile: ChatModelProfile = {
      id: "legacy-chat",
      name: "Legacy chat",
      serverProfileId: server.id,
      modelName: model.name,
      toolsEnabled: false,
      noteMutationAccess: false,
      reasoning: { mode: "off", summary: "off" },
      capabilities: { chat: true, embeddings: false, detectionSource: "format-default" },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const onSave = vi.fn(async () => {});
    const modal = new ModelProfileModal<ChatModelProfile>(new App() as unknown as ObsidianApp, {
      t,
      kind: "chat",
      profile,
      servers: [server],
      profiles: [profile],
      fetchedModelsByServerId: new Map([[server.id, [model]]]),
      fetchModels: vi.fn(async () => [model]),
      onSave,
    });
    modal.open();

    expect(inputFor(modal.contentEl, "Temperature").value).toBe("");
    expect(inputFor(modal.contentEl, "Max tokens").value).toBe("");
    Array.from(modal.contentEl.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Save")!
      .click();

    await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "legacy-chat",
        temperature: undefined,
        maxTokens: undefined,
        reasoning: expect.objectContaining({ mode: "off" }),
      }),
    );
  });
});
