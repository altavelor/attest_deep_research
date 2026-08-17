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

function toggleFor(container: HTMLElement, name: string): HTMLInputElement {
  const setting = Array.from(container.querySelectorAll(".setting-item")).find(
    (item) => item.firstElementChild?.textContent === name,
  );
  expect(setting).toBeDefined();
  const toggle = setting!.querySelector<HTMLInputElement>('input[type="checkbox"]');
  expect(toggle).not.toBeNull();
  return toggle!;
}

function verifiedChatProfile(overrides: Partial<ChatModelProfile> = {}): ChatModelProfile {
  return {
    id: "chat-verified",
    name: "Verified chat",
    serverProfileId: server.id,
    modelName: model.name,
    toolsEnabled: true,
    noteMutationAccess: true,
    reasoning: { mode: "on", summary: "off" },
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
    ...overrides,
  };
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
      '.attest-profile-modal__model-option[role="option"]',
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

  it("prefills advertised reasoning efforts when a model is selected", async () => {
    const advertised: DiscoveredModel = {
      id: "reasoner",
      name: "reasoner",
      capabilities: { chat: true, embeddings: false, detectionSource: "metadata" },
      capabilitySnapshot: {
        protocols: { chatCompletions: "supported", responses: "unknown" },
        reasoning: {
          responseFormats: [],
          visibleOutput: "unknown",
          efforts: ["xhigh", "medium", "low"],
          defaultEffort: "xhigh",
        },
        tools: "supported",
        continuation: "unknown",
        summary: "unknown",
        source: "metadata",
        checkedAt: "2026-01-01T00:00:00.000Z",
        contractVersion: 1,
      },
    };
    const onSave = vi.fn(async () => {});
    const modal = new ModelProfileModal<ChatModelProfile>(new App() as unknown as ObsidianApp, {
      t,
      kind: "chat",
      servers: [server],
      profiles: [],
      fetchedModelsByServerId: new Map([[server.id, [advertised]]]),
      fetchModels: vi.fn(async () => [advertised]),
      onSave,
    });
    modal.open();

    const modelInput = inputFor(modal.contentEl, "Model");
    modelInput.focus();
    modelInput.dispatchEvent(new Event("focus"));
    modal.contentEl
      .querySelector<HTMLButtonElement>('.attest-profile-modal__model-option[role="option"]')!
      .click();

    const effortSelect = Array.from(modal.contentEl.querySelectorAll("select")).at(-1)!;
    expect(Array.from(effortSelect.options, (option) => option.value)).toEqual([
      "",
      "xhigh",
      "medium",
      "low",
    ]);
    expect(effortSelect.disabled).toBe(false);
  });

  it("saves metadata capabilities of an existing profile that was never probed", async () => {
    const advertised: DiscoveredModel = {
      id: "reasoner",
      name: "reasoner",
      capabilities: { chat: true, embeddings: false, detectionSource: "metadata" },
      capabilitySnapshot: {
        protocols: { chatCompletions: "supported", responses: "unknown" },
        reasoning: { responseFormats: [], visibleOutput: "unknown", efforts: ["low", "high"] },
        tools: "supported",
        continuation: "unknown",
        summary: "unknown",
        source: "metadata",
        checkedAt: "2026-01-01T00:00:00.000Z",
        contractVersion: 1,
      },
    };
    const profile: ChatModelProfile = {
      id: "chat-plain",
      name: "Plain chat",
      serverProfileId: server.id,
      modelName: advertised.name,
      toolsEnabled: false,
      noteMutationAccess: false,
      reasoning: { mode: "auto", summary: "off" },
      capabilities: { chat: true, embeddings: false, detectionSource: "format-default" },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const onSave = vi.fn(async (_profile: ChatModelProfile) => {});
    const modal = new ModelProfileModal<ChatModelProfile>(new App() as unknown as ObsidianApp, {
      t,
      kind: "chat",
      profile,
      servers: [server],
      profiles: [profile],
      fetchedModelsByServerId: new Map([[server.id, [advertised]]]),
      fetchModels: vi.fn(async () => [advertised]),
      onSave,
      resolveProfile: (id) => (id === profile.id ? profile : undefined),
    });
    modal.open();

    Array.from(modal.contentEl.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Save")!
      .click();

    await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        toolsEnabled: true,
        noteMutationAccess: false,
        reasoningCapabilities: expect.objectContaining({
          source: "metadata",
          efforts: ["low", "high"],
        }),
        capabilities: expect.objectContaining({
          toolCalling: expect.objectContaining({
            formatDefault: expect.objectContaining({ calls: true }),
          }),
        }),
      }),
    );
    expect(onSave.mock.lastCall?.[0]).not.toHaveProperty("toolCapabilities");
  });

  it("replaces an effort the newly selected model does not advertise", () => {
    const first: DiscoveredModel = {
      id: "first",
      name: "first",
      capabilities: { chat: true, embeddings: false, detectionSource: "metadata" },
      capabilitySnapshot: {
        protocols: { chatCompletions: "supported", responses: "unknown" },
        reasoning: {
          responseFormats: [],
          visibleOutput: "unknown",
          efforts: ["xhigh"],
          defaultEffort: "xhigh",
        },
        tools: "supported",
        continuation: "unknown",
        summary: "unknown",
        source: "metadata",
        checkedAt: "2026-01-01T00:00:00.000Z",
        contractVersion: 1,
      },
    };
    const second: DiscoveredModel = {
      ...first,
      id: "second",
      name: "second",
      capabilitySnapshot: {
        ...first.capabilitySnapshot!,
        reasoning: {
          responseFormats: [],
          visibleOutput: "unknown",
          efforts: ["low", "high"],
          defaultEffort: "low",
        },
      },
    };
    const modal = new ModelProfileModal<ChatModelProfile>(new App() as unknown as ObsidianApp, {
      t,
      kind: "chat",
      servers: [server],
      profiles: [],
      fetchedModelsByServerId: new Map([[server.id, [first, second]]]),
      fetchModels: vi.fn(async () => [first, second]),
      onSave: vi.fn(async () => {}),
    });
    modal.open();

    const pick = (name: string): void => {
      const modelInput = inputFor(modal.contentEl, "Model");
      modelInput.value = "";
      modelInput.dispatchEvent(new Event("input"));
      modelInput.focus();
      modelInput.dispatchEvent(new Event("focus"));
      Array.from(
        modal.contentEl.querySelectorAll<HTMLButtonElement>(
          '.attest-profile-modal__model-option[role="option"]',
        ),
      )
        .find((option) => option.textContent === name)!
        .click();
    };

    pick("first");
    expect(Array.from(modal.contentEl.querySelectorAll("select")).at(-1)!.value).toBe("xhigh");

    pick("second");
    const effortSelect = Array.from(modal.contentEl.querySelectorAll("select")).at(-1)!;
    expect(Array.from(effortSelect.options, (option) => option.value)).toEqual(["", "low", "high"]);
    expect(effortSelect.value).toBe("low");
  });

  it("projects advertised tool controls into the saved profile", async () => {
    const advertised: DiscoveredModel = {
      id: "tooling",
      name: "tooling",
      capabilities: { chat: true, embeddings: false, detectionSource: "metadata" },
      capabilitySnapshot: {
        protocols: { chatCompletions: "supported", responses: "unknown" },
        reasoning: { responseFormats: [], visibleOutput: "unknown", efforts: ["low"] },
        tools: "supported",
        toolControls: { choiceRequired: true, choiceSpecific: true, parallelCalls: false },
        continuation: "unknown",
        summary: "unknown",
        source: "metadata",
        checkedAt: "2026-01-01T00:00:00.000Z",
        contractVersion: 1,
      },
    };
    const onSave = vi.fn(async (_profile: ChatModelProfile) => {});
    const modal = new ModelProfileModal<ChatModelProfile>(new App() as unknown as ObsidianApp, {
      t,
      kind: "chat",
      servers: [server],
      profiles: [],
      fetchedModelsByServerId: new Map([[server.id, [advertised]]]),
      fetchModels: vi.fn(async () => [advertised]),
      onSave,
    });
    modal.open();

    inputFor(modal.contentEl, "Name").value = "Tooling";
    inputFor(modal.contentEl, "Name").dispatchEvent(new Event("input"));
    const modelInput = inputFor(modal.contentEl, "Model");
    modelInput.focus();
    modelInput.dispatchEvent(new Event("focus"));
    modal.contentEl
      .querySelector<HTMLButtonElement>('.attest-profile-modal__model-option[role="option"]')!
      .click();
    Array.from(modal.contentEl.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Save")!
      .click();

    await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.lastCall?.[0].capabilities?.toolCalling?.formatDefault).toEqual({
      calls: true,
      choiceRequired: true,
      choiceSpecific: true,
      parallelCalls: false,
    });
  });

  it("keeps probe results when re-rendering a profile with discovered metadata", () => {
    const probed = verifiedChatProfile();
    const advertised: DiscoveredModel = {
      id: model.id,
      name: model.name,
      capabilities: { chat: true, embeddings: false, detectionSource: "metadata" },
      capabilitySnapshot: {
        protocols: { chatCompletions: "supported", responses: "unknown" },
        reasoning: { responseFormats: [], visibleOutput: "unknown", efforts: ["low"] },
        tools: "unknown",
        continuation: "unknown",
        summary: "unknown",
        source: "metadata",
        checkedAt: "2026-01-01T00:00:00.000Z",
        contractVersion: 1,
      },
    };
    let notify: (() => void) | undefined;
    const onSave = vi.fn(async (_profile: ChatModelProfile) => {});
    const modal = new ModelProfileModal<ChatModelProfile>(new App() as unknown as ObsidianApp, {
      t,
      kind: "chat",
      profile: probed,
      servers: [server],
      profiles: [probed],
      fetchedModelsByServerId: new Map([[server.id, [advertised]]]),
      fetchModels: vi.fn(async () => [advertised]),
      onSave,
      resolveProfile: (id) => (id === probed.id ? probed : undefined),
      subscribeCapabilityStatus: (listener) => {
        notify = listener;
        return () => {};
      },
    });
    modal.open();

    notify!();

    const lines = Array.from(
      modal.contentEl.querySelectorAll(".attest-profile-modal__capability-status-line"),
      (line) => line.textContent,
    );
    expect(lines).toEqual(["Tools support: Verified", "Agent mode support: Verified"]);
    expect(toggleFor(modal.contentEl, "Tools").checked).toBe(true);
  });

  it("seeds metadata for the capability that has no probe result", () => {
    const advertised: DiscoveredModel = {
      id: model.id,
      name: model.name,
      capabilities: { chat: true, embeddings: false, detectionSource: "metadata" },
      capabilitySnapshot: {
        protocols: { chatCompletions: "supported", responses: "unknown" },
        reasoning: { responseFormats: [], visibleOutput: "unknown", efforts: ["low", "high"] },
        tools: "supported",
        continuation: "unknown",
        summary: "unknown",
        source: "metadata",
        checkedAt: "2026-01-01T00:00:00.000Z",
        contractVersion: 1,
      },
    };
    const toolsProbedOnly = verifiedChatProfile({
      id: "tools-only",
      reasoningCapabilities: undefined,
      reasoning: { mode: "auto", summary: "off" },
    });
    const modal = new ModelProfileModal<ChatModelProfile>(new App() as unknown as ObsidianApp, {
      t,
      kind: "chat",
      profile: toolsProbedOnly,
      servers: [server],
      profiles: [toolsProbedOnly],
      fetchedModelsByServerId: new Map([[server.id, [advertised]]]),
      fetchModels: vi.fn(async () => [advertised]),
      onSave: vi.fn(async (_profile: ChatModelProfile) => {}),
      resolveProfile: (id) => (id === toolsProbedOnly.id ? toolsProbedOnly : undefined),
    });
    modal.open();

    const lines = Array.from(
      modal.contentEl.querySelectorAll(".attest-profile-modal__capability-status-line"),
      (line) => line.textContent,
    );
    expect(lines).toEqual(["Tools support: Verified", "Agent mode support: Reported by provider"]);
    const effortSelect = Array.from(modal.contentEl.querySelectorAll("select")).at(-1)!;
    expect(Array.from(effortSelect.options, (option) => option.value)).toEqual(["", "low", "high"]);
  });

  it("drops the saved capability status once another model is selected", () => {
    const other: DiscoveredModel = {
      id: "other-model",
      name: "other-model",
      capabilities: { chat: true, embeddings: false, detectionSource: "metadata" },
    };
    const probed = verifiedChatProfile();
    const modal = new ModelProfileModal<ChatModelProfile>(new App() as unknown as ObsidianApp, {
      t,
      kind: "chat",
      profile: probed,
      servers: [server],
      profiles: [probed],
      fetchedModelsByServerId: new Map([[server.id, [model, other]]]),
      fetchModels: vi.fn(async () => [model, other]),
      onSave: vi.fn(async (_profile: ChatModelProfile) => {}),
      resolveProfile: (id) => (id === probed.id ? probed : undefined),
      getCapabilityStatus: () => ({ tools: "verified", agent: "verified" }),
    });
    modal.open();

    const statusLines = (): (string | null)[] =>
      Array.from(
        modal.contentEl.querySelectorAll(".attest-profile-modal__capability-status-line"),
        (line) => line.textContent,
      );
    expect(statusLines()).toEqual(["Tools support: Verified", "Agent mode support: Verified"]);

    const modelInput = inputFor(modal.contentEl, "Model");
    modelInput.value = "";
    modelInput.dispatchEvent(new Event("input"));
    modelInput.focus();
    modelInput.dispatchEvent(new Event("focus"));
    Array.from(
      modal.contentEl.querySelectorAll<HTMLButtonElement>(
        '.attest-profile-modal__model-option[role="option"]',
      ),
    )
      .find((option) => option.textContent === "other-model")!
      .click();

    expect(statusLines()).toEqual(["Tools support: Not tested", "Agent mode support: Not tested"]);
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
      .querySelector<HTMLButtonElement>('.attest-profile-modal__model-option[role="option"]')!
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

  it("shows each capability on its own line and reports provider-advertised support", () => {
    const advertised: DiscoveredModel = {
      id: "reasoner",
      name: "reasoner",
      capabilities: { chat: true, embeddings: false, detectionSource: "metadata" },
      capabilitySnapshot: {
        protocols: { chatCompletions: "supported", responses: "unknown" },
        reasoning: { responseFormats: [], visibleOutput: "unknown", efforts: ["low"] },
        tools: "supported",
        continuation: "unknown",
        summary: "unknown",
        source: "metadata",
        checkedAt: "2026-01-01T00:00:00.000Z",
        contractVersion: 1,
      },
    };
    const modal = new ModelProfileModal<ChatModelProfile>(new App() as unknown as ObsidianApp, {
      t,
      kind: "chat",
      servers: [server],
      profiles: [],
      fetchedModelsByServerId: new Map([[server.id, [advertised]]]),
      fetchModels: vi.fn(async () => [advertised]),
      onSave: vi.fn(async () => {}),
    });
    modal.open();

    const modelInput = inputFor(modal.contentEl, "Model");
    modelInput.focus();
    modelInput.dispatchEvent(new Event("focus"));
    modal.contentEl
      .querySelector<HTMLButtonElement>('.attest-profile-modal__model-option[role="option"]')!
      .click();

    const lines = Array.from(
      modal.contentEl.querySelectorAll(".attest-profile-modal__capability-status-line"),
      (line) => line.textContent,
    );
    expect(lines).toEqual([
      "Tools support: Reported by provider",
      "Agent mode support: Reported by provider",
    ]);
  });

  it("locks the capability test button while a test is running", () => {
    const profile = verifiedChatProfile();
    const modal = new ModelProfileModal<ChatModelProfile>(new App() as unknown as ObsidianApp, {
      t,
      kind: "chat",
      profile,
      servers: [server],
      profiles: [profile],
      fetchedModelsByServerId: new Map([[server.id, [model]]]),
      fetchModels: vi.fn(async () => [model]),
      onSave: vi.fn(async () => {}),
      onTest: vi.fn(async () => {}),
      resolveProfile: (id) => (id === profile.id ? profile : undefined),
      getCapabilityStatus: () => ({ tools: "testing", agent: "testing" }),
    });
    modal.open();

    const testButton = modal.contentEl.querySelector<HTMLButtonElement>(".attest-capability-test")!;
    expect(testButton.disabled).toBe(true);
    expect(testButton.hasClass("is-testing")).toBe(true);
  });

  it("keeps the advanced section open across a re-render", () => {
    const profile = verifiedChatProfile();
    let notify: (() => void) | undefined;
    const modal = new ModelProfileModal<ChatModelProfile>(new App() as unknown as ObsidianApp, {
      t,
      kind: "chat",
      profile,
      servers: [server],
      profiles: [profile],
      fetchedModelsByServerId: new Map([[server.id, [model]]]),
      fetchModels: vi.fn(async () => [model]),
      onSave: vi.fn(async () => {}),
      resolveProfile: (id) => (id === profile.id ? profile : undefined),
      subscribeCapabilityStatus: (listener) => {
        notify = listener;
        return () => {};
      },
    });
    modal.open();

    const advanced = modal.contentEl.querySelector<HTMLDetailsElement>(
      ".attest-profile-modal__advanced",
    )!;
    expect(advanced.open).toBe(false);
    advanced.open = true;
    advanced.dispatchEvent(new Event("toggle"));

    notify!();

    expect(
      modal.contentEl.querySelector<HTMLDetailsElement>(".attest-profile-modal__advanced")!.open,
    ).toBe(true);
  });

  it("enables tools by default once tools and agent mode become verified", () => {
    const unverified = verifiedChatProfile({
      toolsEnabled: false,
      noteMutationAccess: false,
      reasoningCapabilities: undefined,
      capabilities: { chat: true, embeddings: false, detectionSource: "format-default" },
    });
    let current = unverified;
    let notify: (() => void) | undefined;
    const modal = new ModelProfileModal<ChatModelProfile>(new App() as unknown as ObsidianApp, {
      t,
      kind: "chat",
      profile: unverified,
      servers: [server],
      profiles: [unverified],
      fetchedModelsByServerId: new Map([[server.id, [model]]]),
      fetchModels: vi.fn(async () => [model]),
      onSave: vi.fn(async () => {}),
      resolveProfile: (id) => (id === current.id ? current : undefined),
      subscribeCapabilityStatus: (listener) => {
        notify = listener;
        return () => {};
      },
    });
    modal.open();

    expect(toggleFor(modal.contentEl, "Tools").checked).toBe(false);

    current = verifiedChatProfile({ id: unverified.id, toolsEnabled: false });
    notify!();

    expect(toggleFor(modal.contentEl, "Tools").checked).toBe(true);
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
