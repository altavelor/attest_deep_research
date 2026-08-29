// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, Platform, TFile, TFolder } from "../stubs/obsidian";
import type { App as ObsidianApp } from "obsidian";

import { createTranslator } from "@adapters/i18n";
import type { IndexingState } from "@adapters/indexing";
import type {
  AppliedOnboarding,
  DiscoveredModel,
  ModelDiscoveryResult,
  ServerProfile,
} from "@adapters/settings";
import { OnboardingModal } from "@apps/obsidian/ui/onboarding";
import type { OnboardingModalOptions } from "@apps/obsidian/ui/onboarding";
import { installObsidianDomHelpers, resetDom } from "../helpers/domHarness";

const t = createTranslator("en").t;

function model(name: string, kind: "chat" | "embedding"): DiscoveredModel {
  return {
    id: name,
    name,
    capabilities: {
      chat: kind === "chat",
      embeddings: kind === "embedding",
      detectionSource: "metadata",
    },
  };
}

const discovered: ModelDiscoveryResult = {
  ok: true,
  message: "Connected.",
  models: [model("gpt-4.1-mini", "chat"), model("nomic-embed-text", "embedding")],
};

function settingFor(container: HTMLElement, name: string): HTMLElement | undefined {
  return Array.from(container.querySelectorAll<HTMLElement>(".setting-item")).find((item) =>
    Array.from(item.querySelectorAll<HTMLElement>("*"), (child) => child).some(
      (child) => child.children.length === 0 && child.textContent === name,
    ),
  );
}

function inputFor(container: HTMLElement, name: string): HTMLInputElement {
  return settingFor(container, name)!.querySelector<HTMLInputElement>("input")!;
}

function buttons(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
}

function button(container: HTMLElement, label: string): HTMLButtonElement | undefined {
  return buttons(container).find((candidate) => candidate.textContent === label);
}

function click(container: HTMLElement, label: string): void {
  const target = button(container, label);
  if (!target) {
    throw new Error(
      `No button labelled "${label}". Present: ${buttons(container)
        .map((b) => b.textContent)
        .join(" | ")}`,
    );
  }
  target.click();
}

function type(container: HTMLElement, name: string, value: string): void {
  const input = inputFor(container, name);
  input.value = value;
  input.dispatchEvent(new Event("input"));
}

function choose(container: HTMLElement, name: string, value: string): void {
  const setting = settingFor(container, name)!;
  const select = setting.querySelector<HTMLSelectElement>("select");
  if (select) {
    select.value = value;
    select.dispatchEvent(new Event("change"));
    return;
  }
  const input = setting.querySelector<HTMLInputElement>("input")!;
  input.value = value;
  input.dispatchEvent(new Event("input"));
}

/** Picks a model the way a user does: open the list, click the option. */
function pickModel(container: HTMLElement, name: string, value: string): void {
  const setting = settingFor(container, name)!;
  const input = setting.querySelector<HTMLInputElement>("input")!;
  input.dispatchEvent(new Event("focus"));
  const option = Array.from(setting.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) => candidate.textContent === value,
  );
  if (!option) {
    throw new Error(`No model option "${value}" in the list.`);
  }
  option.click();
}

function indexingState(overrides: Partial<IndexingState>): IndexingState {
  return {
    status: "indexing",
    scannedFiles: 0,
    totalFiles: 0,
    progress: 0,
    indexedFiles: 0,
    skippedFiles: 0,
    embeddedChunks: 0,
    deferredFiles: 0,
    failedFiles: 0,
    isStale: false,
    ...overrides,
  };
}

/** Runs the vault route to the finish screen with a controllable index watch. */
async function finishVaultRoute(
  watchIndexing: OnboardingModalOptions["watchIndexing"],
): Promise<{ modal: OnboardingModal }> {
  const { modal, options } = openModal({
    onComplete: vi.fn(async () => ({
      chatModelProfileId: "chat-1",
      indexProfileId: "index-1",
      embeddingModelProfileId: "embedding-1",
    })),
    watchIndexing,
  });
  await completeChatStep(modal.contentEl);
  chooseScope(modal.contentEl, "My notes and the web");
  click(modal.contentEl, "Continue");
  choose(modal.contentEl, "Embedding model", "nomic-embed-text");
  click(modal.contentEl, "Continue");
  await vi.waitFor(() => expect(settingFor(modal.contentEl, "Folders")).toBeDefined());
  click(modal.contentEl, "Start indexing");
  await vi.waitFor(() => expect(options.onStartIndexing).toHaveBeenCalled());
  return { modal };
}

function chooseScope(container: HTMLElement, name: string): void {
  const checkbox = settingFor(container, name)!.querySelector<HTMLInputElement>(
    'input[type="checkbox"]',
  )!;
  checkbox.checked = true;
  checkbox.dispatchEvent(new Event("change"));
}

class NamedFolder extends TFolder {
  constructor(
    path: string,
    readonly name: string,
  ) {
    super(path);
  }
}

class NamedFile extends TFile {
  constructor(
    path: string,
    readonly name: string,
  ) {
    super(path);
  }
}

/** Minimal vault the folder picker can walk. */
function vaultApp(): ObsidianApp {
  const root = new NamedFolder("", "");
  const projects = new NamedFolder("Projects", "Projects");
  const note = new NamedFile("Projects/Plan.md", "Plan.md");
  projects.children = [note];
  root.children = [projects];
  const byPath = new Map<string, TFile | TFolder>([
    ["Projects", projects],
    ["Projects/Plan.md", note],
  ]);
  return {
    vault: {
      getRoot: () => root,
      getAllLoadedFiles: () => [projects, note],
      getAbstractFileByPath: (path: string) => byPath.get(path) ?? null,
    },
  } as unknown as ObsidianApp;
}

function openModal(overrides: Partial<OnboardingModalOptions> = {}, app?: ObsidianApp) {
  const options: OnboardingModalOptions = {
    t,
    isMobile: false,
    fetchModels: vi.fn(async () => discovered),
    verifyEmbedding: vi.fn(async () => true),
    onComplete: vi.fn(async () => ({ chatModelProfileId: "chat-1" })),
    onStartIndexing: vi.fn(),
    onOpenChat: vi.fn(async () => {}),
    onSkip: vi.fn(),
    ...overrides,
  };
  const modal = new OnboardingModal(app ?? (new App() as unknown as ObsidianApp), options);
  modal.open();
  return { modal, options };
}

async function completeChatStep(container: HTMLElement): Promise<void> {
  choose(container, "Provider", "openai");
  type(container, "API key (optional)", "secret");
  click(container, "Test connection");
  await vi.waitFor(() => expect(settingFor(container, "Chat model")).toBeDefined());
  choose(container, "Chat model", "gpt-4.1-mini");
  click(container, "Continue");
}

describe("OnboardingModal", () => {
  beforeEach(() => {
    installObsidianDomHelpers();
    Platform.isMobile = false;
  });
  afterEach(() => {
    Reflect.deleteProperty(window, "visualViewport");
    resetDom();
    vi.restoreAllMocks();
  });

  it("keeps Continue disabled until a chat model is chosen", async () => {
    const { modal } = openModal();

    expect(button(modal.contentEl, "Continue")?.disabled).toBe(true);
    choose(modal.contentEl, "Provider", "openai");
    expect(button(modal.contentEl, "Continue")?.disabled).toBe(true);

    click(modal.contentEl, "Test connection");
    await vi.waitFor(() => expect(settingFor(modal.contentEl, "Chat model")).toBeDefined());
    choose(modal.contentEl, "Chat model", "gpt-4.1-mini");

    expect(button(modal.contentEl, "Continue")?.disabled).toBe(false);
  });

  it("shows connection success and failure icons before the test button", async () => {
    const fetchModels = vi
      .fn<OnboardingModalOptions["fetchModels"]>()
      .mockResolvedValueOnce(discovered)
      .mockResolvedValueOnce({ ok: false, message: "Invalid API key", models: [] });
    const { modal } = openModal({ fetchModels });
    choose(modal.contentEl, "Provider", "openai");

    click(modal.contentEl, "Test connection");
    await vi.waitFor(() =>
      expect(
        settingFor(modal.contentEl, "Connection")?.querySelector(
          '.attest-onboarding__connection-status[data-icon="check"]',
        ),
      ).not.toBeNull(),
    );
    const successStatus = settingFor(modal.contentEl, "Connection")!.querySelector<HTMLElement>(
      '.attest-onboarding__connection-status[data-icon="check"]',
    )!;
    expect(successStatus.parentElement?.firstElementChild).toBe(successStatus);

    click(modal.contentEl, "Test connection");
    await vi.waitFor(() =>
      expect(
        settingFor(modal.contentEl, "Connection")?.querySelector(
          '.attest-onboarding__connection-status[data-icon="x"]',
        ),
      ).not.toBeNull(),
    );
    expect(settingFor(modal.contentEl, "Connection")?.textContent).toContain("Invalid API key");
  });

  it("filters chat models by substring and accepts a manually typed model id", async () => {
    const manyModels: ModelDiscoveryResult = {
      ok: true,
      message: "Connected.",
      models: [
        model("openai/gpt-4.1-mini", "chat"),
        model("openai/gpt-5", "chat"),
        model("vendor/claude-sonnet", "chat"),
      ],
    };
    const { modal } = openModal({ fetchModels: vi.fn(async () => manyModels) });
    choose(modal.contentEl, "Provider", "openai");
    click(modal.contentEl, "Test connection");
    await vi.waitFor(() => expect(inputFor(modal.contentEl, "Chat model")).toBeDefined());

    type(modal.contentEl, "Chat model", "GPT-4");
    const modelInput = inputFor(modal.contentEl, "Chat model");
    const modelMenu = modal.contentEl.querySelector<HTMLElement>(
      '.attest-profile-modal__model-menu[role="listbox"]',
    )!;
    expect(modelMenu.parentElement).toBe(modelInput.parentElement);
    expect(modelMenu.parentElement?.classList.contains("setting-item-control")).toBe(true);
    expect(modelInput.getAttribute("role")).toBe("combobox");
    expect(modelInput.getAttribute("aria-controls")).toBe(modelMenu.id);
    expect(modelInput.getAttribute("aria-expanded")).toBe("true");
    const options = Array.from(
      modal.contentEl.querySelectorAll<HTMLButtonElement>(
        '.attest-profile-modal__model-option[role="option"]',
      ),
      (option) => option.textContent,
    );
    expect(options).toEqual(["openai/gpt-4.1-mini"]);

    type(modal.contentEl, "Chat model", "custom/manual-model");
    expect(button(modal.contentEl, "Continue")?.disabled).toBe(false);

    const outside = modal.contentEl.querySelector<HTMLElement>("h2")!;
    modelInput.parentElement!.dispatchEvent(
      new FocusEvent("focusout", { bubbles: true, relatedTarget: outside }),
    );
    expect(modelMenu.classList.contains("is-hidden")).toBe(true);
    expect(modelInput.getAttribute("aria-expanded")).toBe("false");

    modal.close();
    expect(document.querySelector(".attest-onboarding__model-menu")).toBeNull();
  });

  it("preselects no scope and blocks Continue until one is picked", async () => {
    const { modal } = openModal();
    await completeChatStep(modal.contentEl);

    expect(modal.contentEl.querySelector(".attest-onboarding__choice.is-selected")).toBeNull();
    expect(modal.contentEl.querySelectorAll('input[type="checkbox"]')).toHaveLength(3);
    expect(modal.contentEl.querySelectorAll(".attest-onboarding__choice button")).toHaveLength(0);
    expect(
      modal.contentEl.querySelector(".attest-onboarding__scope-choices")?.children,
    ).toHaveLength(3);
    expect(
      settingFor(modal.contentEl, "My notes and the web")?.firstElementChild?.classList.contains(
        "setting-item-control",
      ),
    ).toBe(true);
    const firstChoice = settingFor(modal.contentEl, "My notes and the web")!;
    expect(firstChoice.tagName).toBe("LABEL");
    expect(
      firstChoice
        .querySelector(".setting-item-control")
        ?.contains(inputFor(modal.contentEl, "My notes and the web")),
    ).toBe(true);
    expect(firstChoice.querySelector(".attest-onboarding__scope-remaining")?.textContent).toBe(
      "2 steps left",
    );
    expect(modal.contentEl.querySelector(".attest-onboarding__footer-hint")?.textContent).toBe(
      "Pick one to continue",
    );
    expect(button(modal.contentEl, "Continue")?.disabled).toBe(true);

    chooseScope(modal.contentEl, "The web only");

    expect(inputFor(modal.contentEl, "The web only").checked).toBe(true);
    expect(button(modal.contentEl, "Finish")?.disabled).toBe(false);
  });

  it("keeps exactly one scope checkbox selected", async () => {
    const { modal } = openModal();
    await completeChatStep(modal.contentEl);

    chooseScope(modal.contentEl, "The web only");
    chooseScope(modal.contentEl, "My notes and the web");

    expect(inputFor(modal.contentEl, "The web only").checked).toBe(false);
    const selected = inputFor(modal.contentEl, "My notes and the web");
    expect(selected.checked).toBe(true);

    selected.checked = false;
    selected.dispatchEvent(new Event("change"));

    expect(inputFor(modal.contentEl, "My notes and the web").checked).toBe(true);
  });

  it("shows four steps before a scope is picked and two after choosing the web", async () => {
    const { modal } = openModal();
    await completeChatStep(modal.contentEl);

    const initialFooter = modal.contentEl.querySelector<HTMLElement>(
      ".attest-onboarding__footer-bar",
    );
    expect(initialFooter?.firstElementChild?.textContent).toBe("Back");
    expect(
      initialFooter?.querySelector(".attest-onboarding__steps")?.getAttribute("aria-label"),
    ).toBe("Step 2 of 4");
    expect(initialFooter?.querySelectorAll(".attest-onboarding__step-dot")).toHaveLength(4);
    expect(
      initialFooter?.querySelectorAll(".attest-onboarding__step-dot.is-complete"),
    ).toHaveLength(2);
    chooseScope(modal.contentEl, "The web only");
    const webFooter = modal.contentEl.querySelector<HTMLElement>(".attest-onboarding__footer-bar");
    expect(webFooter?.querySelector(".attest-onboarding__steps")?.getAttribute("aria-label")).toBe(
      "Step 2 of 2",
    );
    expect(webFooter?.querySelectorAll(".attest-onboarding__step-dot")).toHaveLength(2);
    expect(webFooter?.lastElementChild?.textContent).toContain("Finish");
  });

  it("finishes the web-only route without an embedding model or an index", async () => {
    const { modal, options } = openModal();
    await completeChatStep(modal.contentEl);
    chooseScope(modal.contentEl, "The web only");
    click(modal.contentEl, "Finish");

    await vi.waitFor(() => expect(options.onComplete).toHaveBeenCalled());
    const result = vi.mocked(options.onComplete).mock.calls[0][0];
    expect(result.scope).toBe("webOnly");
    expect(result.embedding).toBeUndefined();
    expect(result.index).toBeUndefined();
    expect(result.chat).toEqual({
      server: {
        name: "OpenAI",
        apiFormat: "openai-compatible",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "secret",
      },
      modelName: "gpt-4.1-mini",
      capabilities: discovered.models[0].capabilities,
    });
    expect(options.onStartIndexing).not.toHaveBeenCalled();
    expect(modal.contentEl.querySelector(".attest-onboarding__finish-title")?.textContent).toBe(
      "Web research is ready",
    );
    expect(modal.contentEl.querySelector(".attest-onboarding__finish-status")?.textContent).toBe(
      "2 profiles · 0 s wait",
    );
    expect(modal.contentEl.querySelectorAll(".attest-onboarding__finish-tag")).toHaveLength(2);
    expect(button(modal.contentEl, "Add vault search later")).toBeDefined();
    expect(modal.contentEl.querySelector(".attest-onboarding__finish-progress")).toBeNull();
  });

  it("verifies the embedding model before it becomes a profile", async () => {
    const { modal, options } = openModal();
    await completeChatStep(modal.contentEl);
    chooseScope(modal.contentEl, "My notes and the web");
    click(modal.contentEl, "Continue");

    choose(modal.contentEl, "Embedding model", "nomic-embed-text");
    click(modal.contentEl, "Continue");

    await vi.waitFor(() => expect(options.verifyEmbedding).toHaveBeenCalled());
    const [server, modelName] = vi.mocked(options.verifyEmbedding).mock.calls[0];
    expect((server as ServerProfile).baseUrl).toBe("https://api.openai.com/v1");
    expect(modelName).toBe("nomic-embed-text");
  });

  it("starts a different embedding server with empty fields", async () => {
    const { modal } = openModal();
    await completeChatStep(modal.contentEl);
    chooseScope(modal.contentEl, "My notes and the web");
    click(modal.contentEl, "Continue");

    inputFor(modal.contentEl, "Same server as the chat model").click();

    expect(
      settingFor(modal.contentEl, "Provider")?.querySelector(
        ".attest-onboarding__previous-provider",
      )?.textContent,
    ).toBe("was: Same as chat (OpenAI)");
    expect(
      settingFor(modal.contentEl, "Provider")?.querySelector<HTMLSelectElement>("select")?.value,
    ).toBe("custom");
    expect(inputFor(modal.contentEl, "Base URL").value).toBe("");
    expect(inputFor(modal.contentEl, "API key (optional)").value).toBe("");
    expect(inputFor(modal.contentEl, "Embedding model").value).toBe("");
    expect(button(modal.contentEl, "Test connection")?.disabled).toBe(true);
    expect(button(modal.contentEl, "Continue")?.disabled).toBe(true);
  });

  it("offers the web-only finish instead of dead-ending when the embedding model fails", async () => {
    const verifyEmbedding = vi.fn(async () => false);
    const { modal, options } = openModal({ verifyEmbedding });
    await completeChatStep(modal.contentEl);
    chooseScope(modal.contentEl, "My notes and the web");
    click(modal.contentEl, "Continue");
    choose(modal.contentEl, "Embedding model", "nomic-embed-text");
    click(modal.contentEl, "Continue");

    await vi.waitFor(() => expect(button(modal.contentEl, "Use the web instead")).toBeDefined());
    expect(options.onComplete).not.toHaveBeenCalled();

    click(modal.contentEl, "Use the web instead");
    await vi.waitFor(() => expect(options.onComplete).toHaveBeenCalled());
    const result = vi.mocked(options.onComplete).mock.calls[0][0];
    expect(result.scope).toBe("webOnly");
    expect(result.embedding).toBeUndefined();
  });

  it("offers the web-only finish when embedding verification rejects", async () => {
    const { modal } = openModal({
      verifyEmbedding: vi.fn(async () => Promise.reject(new Error("network unavailable"))),
    });
    await completeChatStep(modal.contentEl);
    chooseScope(modal.contentEl, "My notes and the web");
    click(modal.contentEl, "Continue");
    choose(modal.contentEl, "Embedding model", "nomic-embed-text");
    click(modal.contentEl, "Continue");

    await vi.waitFor(() => expect(button(modal.contentEl, "Use the web instead")).toBeDefined());
    expect(button(modal.contentEl, "Continue")?.disabled).toBe(false);
  });

  it("allows retrying model discovery after the request rejects", async () => {
    const fetchModels = vi
      .fn<OnboardingModalOptions["fetchModels"]>()
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce(discovered);
    const { modal } = openModal({ fetchModels });
    choose(modal.contentEl, "Provider", "openai");

    click(modal.contentEl, "Test connection");
    await vi.waitFor(() =>
      expect(button(modal.contentEl, "Test connection")?.disabled).toBe(false),
    );
    click(modal.contentEl, "Test connection");

    await vi.waitFor(() => expect(settingFor(modal.contentEl, "Chat model")).toBeDefined());
    expect(fetchModels).toHaveBeenCalledTimes(2);
  });

  it("writes nothing and opens settings when the wizard is skipped", () => {
    const { modal, options } = openModal();

    click(modal.contentEl, "Skip, configure manually");

    expect(options.onSkip).toHaveBeenCalledTimes(1);
    expect(options.onComplete).not.toHaveBeenCalled();
  });

  it("refuses to contact a local provider on mobile", () => {
    const { modal, options } = openModal({ isMobile: true });

    choose(modal.contentEl, "Provider", "ollama");

    expect(modal.contentEl.textContent).toContain("not available on Obsidian Mobile");
    expect(button(modal.contentEl, "Test connection")?.disabled).toBe(true);
    expect(options.fetchModels).not.toHaveBeenCalled();
  });

  it("starts the first index build and reports its progress on the vault route", async () => {
    let publish: ((state: unknown) => void) | undefined;
    const { modal, options } = openModal({
      onComplete: vi.fn(async () => ({
        chatModelProfileId: "chat-1",
        indexProfileId: "index-1",
        embeddingModelProfileId: "embedding-1",
      })),
      watchIndexing: (_id, listener) => {
        publish = listener as (state: unknown) => void;
        return () => {};
      },
    });
    await completeChatStep(modal.contentEl);
    chooseScope(modal.contentEl, "My notes and the web");
    click(modal.contentEl, "Continue");
    choose(modal.contentEl, "Embedding model", "nomic-embed-text");
    click(modal.contentEl, "Continue");
    await vi.waitFor(() => expect(settingFor(modal.contentEl, "Folders")).toBeDefined());
    click(modal.contentEl, "Start indexing");

    await vi.waitFor(() =>
      expect(options.onStartIndexing).toHaveBeenCalledWith("index-1", "embedding-1"),
    );
    const result = vi.mocked(options.onComplete).mock.calls[0][0];
    expect(result.scope).toBe("notesAndWeb");
    expect(result.index).toEqual({
      mode: "wholeVault",
      indexFolder: ".attest/index",
      includeFolders: ["/"],
      excludeGlobs: [".obsidian/**", ".trash/**", ".attest/**"],
    });

    publish?.({
      status: "indexing",
      progress: 0.5,
      scannedFiles: 20,
      totalFiles: 40,
      chunksTotal: 0,
    });
    expect(modal.contentEl.querySelector(".attest-onboarding__finish-title")?.textContent).toBe(
      "Vault search is indexing",
    );
    const progress = modal.contentEl.querySelector<HTMLElement>(
      ".attest-onboarding__finish-progress",
    );
    expect(progress?.getAttribute("role")).toBe("progressbar");
    expect(progress?.getAttribute("aria-valuenow")).toBe("50");
    expect(
      progress?.querySelector<HTMLElement>(".attest-onboarding__finish-progress-value")?.style
        .width,
    ).toBe("50%");
    expect(
      modal.contentEl.querySelector(".attest-onboarding__finish-stats")?.textContent,
    ).toContain("20 / 40 files");
    expect(modal.contentEl.querySelectorAll(".attest-onboarding__finish-tag")).toHaveLength(4);
    expect(button(modal.contentEl, "Keep indexing in background")).toBeDefined();
  });

  it("renders the folders step with the controls from the design", async () => {
    const { modal, options } = openModal();
    await completeChatStep(modal.contentEl);
    chooseScope(modal.contentEl, "My notes and the web");
    click(modal.contentEl, "Continue");
    choose(modal.contentEl, "Embedding model", "nomic-embed-text");
    click(modal.contentEl, "Continue");
    await vi.waitFor(() => expect(settingFor(modal.contentEl, "Folders")).toBeDefined());

    const folders = settingFor(modal.contentEl, "Folders")!;
    expect(folders.querySelector("select")?.value).toBe("wholeVault");
    expect(button(folders, "Choose folders…")).toBeUndefined();
    expect(
      settingFor(modal.contentEl, "Excluded")?.querySelector<HTMLInputElement>("input")?.value,
    ).toBe(".obsidian/**, .trash/**, .attest/**");
    choose(modal.contentEl, "Folders", "selected");
    expect(button(settingFor(modal.contentEl, "Folders")!, "Choose folders…")).toBeDefined();
    choose(modal.contentEl, "Folders", "wholeVault");
    const excluded = settingFor(modal.contentEl, "Excluded")!;
    expect(excluded.textContent).toContain("Prefilled.");
    expect(excluded.querySelector<HTMLInputElement>("input")?.value).toBe("");
    expect(button(excluded, "Choose")).toBeDefined();
    const location = settingFor(modal.contentEl, "Index location")!;
    expect(location.querySelector<HTMLInputElement>("input")?.value).toBe(".attest/index");
    expect(button(location, "Choose")).toBeUndefined();

    type(modal.contentEl, "Excluded", ".obsidian/**, Archive/private.md");
    type(modal.contentEl, "Index location", "Data/attest-index");
    click(modal.contentEl, "Start indexing");

    await vi.waitFor(() => expect(options.onComplete).toHaveBeenCalledTimes(1));
    expect(vi.mocked(options.onComplete).mock.calls[0][0].index).toEqual({
      mode: "wholeVault",
      indexFolder: "Data/attest-index",
      includeFolders: ["/"],
      excludeGlobs: [".obsidian/**", "Archive/private.md"],
    });
  });

  it("releases the indexing subscription when the dialog closes", async () => {
    const unwatch = vi.fn();
    const { modal } = openModal({
      onComplete: vi.fn(async () => ({
        chatModelProfileId: "chat-1",
        indexProfileId: "index-1",
        embeddingModelProfileId: "embedding-1",
      })),
      watchIndexing: () => unwatch,
    });
    await completeChatStep(modal.contentEl);
    chooseScope(modal.contentEl, "My notes and the web");
    click(modal.contentEl, "Continue");
    choose(modal.contentEl, "Embedding model", "nomic-embed-text");
    click(modal.contentEl, "Continue");
    await vi.waitFor(() => expect(settingFor(modal.contentEl, "Folders")).toBeDefined());
    click(modal.contentEl, "Start indexing");
    await vi.waitFor(() => expect(button(modal.contentEl, "Open chat")).toBeDefined());

    modal.close();

    expect(unwatch).toHaveBeenCalledTimes(1);
  });
  it("ignores a model list that arrived for an endpoint the user has since changed", async () => {
    let release: ((result: ModelDiscoveryResult) => void) | undefined;
    const fetchModels = vi.fn(
      () => new Promise<ModelDiscoveryResult>((resolve) => (release = resolve)),
    );
    const { modal } = openModal({ fetchModels });

    choose(modal.contentEl, "Provider", "openai");
    click(modal.contentEl, "Test connection");
    type(modal.contentEl, "Base URL", "https://api.other.test/v1");
    release?.(discovered);
    await vi.waitFor(() => expect(fetchModels).toHaveBeenCalledTimes(1));

    expect(inputFor(modal.contentEl, "Chat model").value).toBe("");
    expect(button(modal.contentEl, "Continue")?.disabled).toBe(true);
  });

  it("applies the wizard once even when the web-only fallback is clicked twice", async () => {
    const { modal, options } = openModal({ verifyEmbedding: vi.fn(async () => false) });
    await completeChatStep(modal.contentEl);
    chooseScope(modal.contentEl, "My notes and the web");
    click(modal.contentEl, "Continue");
    choose(modal.contentEl, "Embedding model", "nomic-embed-text");
    click(modal.contentEl, "Continue");
    await vi.waitFor(() => expect(button(modal.contentEl, "Use the web instead")).toBeDefined());

    const fallback = button(modal.contentEl, "Use the web instead")!;
    fallback.click();
    fallback.click();

    await vi.waitFor(() => expect(options.onComplete).toHaveBeenCalled());
    expect(options.onComplete).toHaveBeenCalledTimes(1);
  });

  it("does not touch a dialog the user closed while a request was in flight", async () => {
    let release: ((result: ModelDiscoveryResult) => void) | undefined;
    const { modal } = openModal({
      fetchModels: vi.fn(() => new Promise<ModelDiscoveryResult>((resolve) => (release = resolve))),
    });
    choose(modal.contentEl, "Provider", "openai");
    click(modal.contentEl, "Test connection");

    modal.close();
    release?.(discovered);
    await Promise.resolve();

    expect(modal.contentEl.childElementCount).toBe(0);
  });

  it("does not start indexing after the dialog closes during completion", async () => {
    let release:
      | ((value: {
          chatModelProfileId: string;
          indexProfileId: string;
          embeddingModelProfileId: string;
        }) => void)
      | undefined;
    const { modal, options } = openModal({
      onComplete: vi.fn(
        () =>
          new Promise<AppliedOnboarding>((resolve) => {
            release = resolve;
          }),
      ),
    });
    await completeChatStep(modal.contentEl);
    chooseScope(modal.contentEl, "The web only");
    click(modal.contentEl, "Finish");

    modal.close();
    release?.({
      chatModelProfileId: "chat-1",
      indexProfileId: "index-1",
      embeddingModelProfileId: "embedding-1",
    });
    await Promise.resolve();

    expect(options.onStartIndexing).not.toHaveBeenCalled();
  });

  it("keeps the dialog open when skipping cannot be saved", async () => {
    const { modal } = openModal({ onSkip: vi.fn(async () => Promise.reject(new Error("disk"))) });

    click(modal.contentEl, "Skip, configure manually");
    await vi.waitFor(() =>
      expect(button(modal.contentEl, "Skip, configure manually")).toBeDefined(),
    );

    expect(modal.contentEl.childElementCount).toBeGreaterThan(0);
  });
  it("refuses an index location that would leave the vault", async () => {
    const { modal, options } = openModal();
    await completeChatStep(modal.contentEl);
    chooseScope(modal.contentEl, "My notes and the web");
    click(modal.contentEl, "Continue");
    choose(modal.contentEl, "Embedding model", "nomic-embed-text");
    click(modal.contentEl, "Continue");
    await vi.waitFor(() => expect(settingFor(modal.contentEl, "Folders")).toBeDefined());

    type(modal.contentEl, "Index location", "../outside-the-vault");

    expect(button(modal.contentEl, "Start indexing")?.disabled).toBe(true);
    expect(settingFor(modal.contentEl, "Index location")?.textContent).toContain(
      "must stay inside the vault",
    );
    expect(options.onComplete).not.toHaveBeenCalled();
  });
  it("hides the exclusion field in selected mode, where the index ignores it", async () => {
    const { modal, options } = openModal();
    await completeChatStep(modal.contentEl);
    chooseScope(modal.contentEl, "My notes and the web");
    click(modal.contentEl, "Continue");
    choose(modal.contentEl, "Embedding model", "nomic-embed-text");
    click(modal.contentEl, "Continue");
    await vi.waitFor(() => expect(settingFor(modal.contentEl, "Folders")).toBeDefined());

    choose(modal.contentEl, "Folders", "selected");

    expect(settingFor(modal.contentEl, "Excluded")).toBeUndefined();
    expect(options.onComplete).not.toHaveBeenCalled();
  });

  it("drops a stale embedding failure when a later check lands under a changed model", async () => {
    let release: ((verified: boolean) => void) | undefined;
    const verifyEmbedding = vi
      .fn<OnboardingModalOptions["verifyEmbedding"]>()
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => (release = resolve)));
    const { modal, options } = openModal({ verifyEmbedding });
    await completeChatStep(modal.contentEl);
    chooseScope(modal.contentEl, "My notes and the web");
    click(modal.contentEl, "Continue");
    choose(modal.contentEl, "Embedding model", "nomic-embed-text");
    click(modal.contentEl, "Continue");
    await vi.waitFor(() => expect(button(modal.contentEl, "Use the web instead")).toBeDefined());

    choose(modal.contentEl, "Embedding model", "second-embedder");
    click(modal.contentEl, "Continue");
    choose(modal.contentEl, "Embedding model", "third-embedder");
    release?.(true);
    await vi.waitFor(() => expect(verifyEmbedding).toHaveBeenCalledTimes(2));

    expect(button(modal.contentEl, "Use the web instead")).toBeUndefined();
    expect(options.onComplete).not.toHaveBeenCalled();
  });

  it("refuses a local provider on mobile even when the model id is typed by hand", async () => {
    const { modal } = openModal({ isMobile: true });

    choose(modal.contentEl, "Provider", "ollama");
    type(modal.contentEl, "Chat model", "llama3");

    expect(button(modal.contentEl, "Continue")?.disabled).toBe(true);
  });

  it("removes the model popover from the document when the dialog closes", async () => {
    const { modal } = openModal();
    choose(modal.contentEl, "Provider", "openai");
    click(modal.contentEl, "Test connection");
    await vi.waitFor(() => expect(inputFor(modal.contentEl, "Chat model")).toBeDefined());

    modal.close();

    expect(document.querySelector(".attest-onboarding__model-menu")).toBeNull();
  });
  it("shows the folders the picker selected, and lets one be removed", async () => {
    const { modal } = openModal({}, vaultApp());
    await completeChatStep(modal.contentEl);
    chooseScope(modal.contentEl, "My notes and the web");
    click(modal.contentEl, "Continue");
    choose(modal.contentEl, "Embedding model", "nomic-embed-text");
    click(modal.contentEl, "Continue");
    await vi.waitFor(() => expect(settingFor(modal.contentEl, "Folders")).toBeDefined());
    choose(modal.contentEl, "Folders", "selected");

    expect(modal.contentEl.querySelector(".attest-onboarding__selected-empty")?.textContent).toBe(
      "Nothing selected yet.",
    );
    expect(button(modal.contentEl, "Start indexing")?.disabled).toBe(true);

    click(modal.contentEl, "Choose folders…");
    const picker = document.querySelectorAll<HTMLElement>(".attest-profile-modal");
    const pickerEl = picker[picker.length - 1];
    const checkbox = pickerEl.querySelector<HTMLInputElement>(".attest-index-path-picker input");
    checkbox!.click();
    Array.from(pickerEl.querySelectorAll<HTMLButtonElement>("button"))
      .find((candidate) => candidate.textContent === "Save")!
      .click();

    const labels = Array.from(
      modal.contentEl.querySelectorAll(".attest-onboarding__selected-path-label"),
      (node) => node.textContent,
    );
    expect(labels.length).toBeGreaterThan(0);
    expect(button(modal.contentEl, "Start indexing")?.disabled).toBe(false);

    modal.contentEl
      .querySelectorAll<HTMLButtonElement>(".attest-onboarding__selected-path-remove")[0]
      .click();

    expect(modal.contentEl.querySelectorAll(".attest-onboarding__selected-path")).toHaveLength(
      labels.length - 1,
    );
  });
  it("checks the embedding model once and not again on the way back and forward", async () => {
    const verifyEmbedding = vi.fn(async () => true);
    const { modal } = openModal({ verifyEmbedding });
    await completeChatStep(modal.contentEl);
    chooseScope(modal.contentEl, "My notes and the web");
    click(modal.contentEl, "Continue");
    choose(modal.contentEl, "Embedding model", "nomic-embed-text");
    click(modal.contentEl, "Continue");
    await vi.waitFor(() => expect(settingFor(modal.contentEl, "Folders")).toBeDefined());

    click(modal.contentEl, "Back");
    click(modal.contentEl, "Continue");

    await vi.waitFor(() => expect(settingFor(modal.contentEl, "Folders")).toBeDefined());
    expect(verifyEmbedding).toHaveBeenCalledTimes(1);
  });

  it("re-checks once the embedding model changes", async () => {
    const verifyEmbedding = vi.fn(async () => true);
    const { modal } = openModal({ verifyEmbedding });
    await completeChatStep(modal.contentEl);
    chooseScope(modal.contentEl, "My notes and the web");
    click(modal.contentEl, "Continue");
    choose(modal.contentEl, "Embedding model", "nomic-embed-text");
    click(modal.contentEl, "Continue");
    await vi.waitFor(() => expect(settingFor(modal.contentEl, "Folders")).toBeDefined());

    click(modal.contentEl, "Back");
    choose(modal.contentEl, "Embedding model", "another-embedder");
    click(modal.contentEl, "Continue");

    await vi.waitFor(() => expect(verifyEmbedding).toHaveBeenCalledTimes(2));
  });

  it("says it is checking while the provider is contacted", async () => {
    let release: ((verified: boolean) => void) | undefined;
    const { modal } = openModal({
      verifyEmbedding: vi.fn(() => new Promise<boolean>((resolve) => (release = resolve))),
    });
    await completeChatStep(modal.contentEl);
    chooseScope(modal.contentEl, "My notes and the web");
    click(modal.contentEl, "Continue");
    choose(modal.contentEl, "Embedding model", "nomic-embed-text");
    click(modal.contentEl, "Continue");

    expect(button(modal.contentEl, "Checking…")).toBeDefined();
    expect(button(modal.contentEl, "Checking…")?.disabled).toBe(true);

    release?.(true);
    await vi.waitFor(() => expect(settingFor(modal.contentEl, "Folders")).toBeDefined());
  });

  it("opens a re-run on the setup the wizard already created", () => {
    const { modal } = openModal({
      prefill: {
        chat: {
          server: {
            name: "OpenAI",
            apiFormat: "openai-compatible",
            baseUrl: "https://api.openai.com/v1",
            apiKey: "secret",
          },
          modelName: "gpt-4.1-mini",
        },
        embeddingSameAsChat: true,
      },
    });

    expect(inputFor(modal.contentEl, "Base URL").value).toBe("https://api.openai.com/v1");
    expect(inputFor(modal.contentEl, "API key (optional)").value).toBe("secret");
    expect(button(modal.contentEl, "Continue")?.disabled).toBe(false);
  });

  it("carries a recorded index selection into the folders step", async () => {
    const { modal } = openModal(
      {
        prefill: {
          chat: {
            server: {
              name: "OpenAI",
              apiFormat: "openai-compatible",
              baseUrl: "https://api.openai.com/v1",
            },
            modelName: "gpt-4.1-mini",
          },
          embedding: {
            server: {
              name: "OpenAI",
              apiFormat: "openai-compatible",
              baseUrl: "https://api.openai.com/v1",
            },
            modelName: "nomic-embed-text",
          },
          embeddingSameAsChat: true,
          index: {
            mode: "selected",
            indexFolder: ".attest/index",
            includeFolders: ["Projects"],
            excludeGlobs: [],
          },
        },
      },
      vaultApp(),
    );

    click(modal.contentEl, "Continue");
    chooseScope(modal.contentEl, "My notes and the web");
    click(modal.contentEl, "Continue");
    click(modal.contentEl, "Continue");
    await vi.waitFor(() => expect(settingFor(modal.contentEl, "Index location")).toBeDefined());

    expect(modal.contentEl.textContent).toContain("Projects");
    expect(inputFor(modal.contentEl, "Index location").value).toBe(".attest/index");
  });

  it("tests the embedding model as soon as it is picked and holds Continue until it answers", async () => {
    let settle: ((verified: boolean) => void) | undefined;
    const verifyEmbedding = vi.fn(() => new Promise<boolean>((resolve) => (settle = resolve)));
    const { modal } = openModal({ verifyEmbedding });
    await completeChatStep(modal.contentEl);
    chooseScope(modal.contentEl, "My notes and the web");
    click(modal.contentEl, "Continue");

    pickModel(modal.contentEl, "Embedding model", "nomic-embed-text");

    await vi.waitFor(() => expect(verifyEmbedding).toHaveBeenCalledTimes(1));
    expect(modal.contentEl.querySelector(".attest-onboarding__model-probe")).not.toBeNull();
    expect(modal.contentEl.textContent).toContain("Testing");
    expect(button(modal.contentEl, "Continue")?.disabled).toBe(true);

    settle?.(true);

    await vi.waitFor(() =>
      expect(modal.contentEl.querySelector(".attest-onboarding__model-probe")).toBeNull(),
    );
    expect(button(modal.contentEl, "Continue")?.disabled).toBe(false);
  });

  it("does not test the model a second time when Continue follows the picked one", async () => {
    const verifyEmbedding = vi.fn(async () => true);
    const { modal } = openModal({ verifyEmbedding });
    await completeChatStep(modal.contentEl);
    chooseScope(modal.contentEl, "My notes and the web");
    click(modal.contentEl, "Continue");

    pickModel(modal.contentEl, "Embedding model", "nomic-embed-text");
    await vi.waitFor(() =>
      expect(modal.contentEl.querySelector(".attest-onboarding__model-probe")).toBeNull(),
    );
    click(modal.contentEl, "Continue");

    await vi.waitFor(() => expect(settingFor(modal.contentEl, "Folders")).toBeDefined());
    expect(verifyEmbedding).toHaveBeenCalledTimes(1);
  });

  it("says the index run finished instead of leaving the screen on indexing", async () => {
    let publish: ((state: IndexingState) => void) | undefined;
    const { modal } = await finishVaultRoute((_, listener) => {
      publish = listener;
      return () => {};
    });

    publish?.(indexingState({ status: "indexing", progress: 0.5, chunksTotal: 2 }));
    expect(modal.contentEl.textContent).toContain("Vault search is indexing");
    expect(button(modal.contentEl, "Keep indexing in background")).toBeDefined();

    publish?.(indexingState({ status: "idle", progress: 1, chunksTotal: 2, chunksEmbedded: 2 }));

    expect(modal.contentEl.textContent).toContain("Vault search is ready");
    expect(modal.contentEl.textContent).toContain("indexing finished");
    expect(button(modal.contentEl, "Keep indexing in background")).toBeUndefined();
    expect(button(modal.contentEl, "Open chat")).toBeDefined();
  });

  it("keeps saying it is indexing while an idle state arrives before the run starts", async () => {
    let publish: ((state: IndexingState) => void) | undefined;
    const { modal } = await finishVaultRoute((_, listener) => {
      publish = listener;
      return () => {};
    });

    publish?.(indexingState({ status: "idle", progress: 0 }));

    expect(modal.contentEl.textContent).toContain("Vault search is indexing");
    expect(modal.contentEl.textContent).not.toContain("Vault search is ready");
  });

  it("reports a failed index run instead of claiming it is still going", async () => {
    let publish: ((state: IndexingState) => void) | undefined;
    const { modal } = await finishVaultRoute((_, listener) => {
      publish = listener;
      return () => {};
    });

    publish?.(indexingState({ status: "indexing", progress: 0.2 }));
    publish?.(
      indexingState({ status: "error", progress: 0.2, errorMessage: "Embedding server refused" }),
    );

    expect(modal.contentEl.textContent).toContain("Vault search stopped");
    expect(modal.contentEl.textContent).toContain("Embedding server refused");
    expect(button(modal.contentEl, "Keep indexing in background")).toBeUndefined();
  });

  it("passes the advertised capabilities of the picked model to the profile builder", async () => {
    const snapshot = {
      checkedAt: "2026-01-01T00:00:00.000Z",
      tools: "supported",
      protocols: { responses: "supported", chatCompletions: "supported" },
      reasoning: {},
      continuation: "unknown",
      summary: "unknown",
    };
    const { modal, options } = openModal({
      fetchModels: vi.fn(async () => ({
        ok: true,
        message: "Connected.",
        models: [
          { ...model("gpt-4.1-mini", "chat"), capabilitySnapshot: snapshot },
          model("nomic-embed-text", "embedding"),
        ],
      })) as unknown as OnboardingModalOptions["fetchModels"],
    });
    await completeChatStep(modal.contentEl);
    chooseScope(modal.contentEl, "The web only");
    click(modal.contentEl, "Finish");

    await vi.waitFor(() => expect(options.onComplete).toHaveBeenCalled());
    const result = vi.mocked(options.onComplete).mock.calls[0][0];
    expect(result.chat.capabilitySnapshot).toEqual(snapshot);
  });
});
