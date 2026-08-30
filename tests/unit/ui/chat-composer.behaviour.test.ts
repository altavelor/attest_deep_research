// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Menu } from "obsidian";

import { createTranslator } from "@adapters/i18n";
import { ChatComposerController } from "@apps/obsidian/ui/chat/ChatComposerController";
import type { ChatComposerControllerOptions } from "@apps/obsidian/ui/chat/ChatComposerController";
import type { ContextWindowUsage } from "@apps/obsidian/ui/chat/contextWindowUsage";
import { createContainer, resetDom } from "../../helpers/domHarness";

interface ComposerHarness {
  controller: ChatComposerController;
  redisplay(): void;
  state: {
    running: boolean;
    attachedContextPaths: string[];
    searchUnavailableMessage: string | null;
    contextWindowUsage: ContextWindowUsage | null;
  };
  textarea(): HTMLTextAreaElement;
  submitButton(): HTMLButtonElement;
  modelButton(): HTMLButtonElement;
  attachButton(): HTMLButtonElement;
  contextIndicator(): HTMLElement;
}

const t = createTranslator("en").t;

let container: HTMLElement;

function createComposer(overrides: Partial<ChatComposerControllerOptions> = {}): ComposerHarness {
  const state = {
    running: false,
    attachedContextPaths: [] as string[],
    searchUnavailableMessage: null as string | null,
    contextWindowUsage: null as ContextWindowUsage | null,
    draft: "",
  };

  const controller = new ChatComposerController({
    getSettings: () => ({ chatModelProfileId: "model-a", searchMode: "indexOnly" }),
    getAvailableModels: () => [
      { id: "model-a", name: "Model A", supportsAgentMode: true },
      { id: "model-b", name: "Model B" },
    ],
    getAvailableIndexes: () => [{ id: "index-a", name: "Index A", isIndexed: true }],
    getDraft: () => state.draft,
    onDraftChange: (draft) => {
      state.draft = draft;
    },
    getContextFilePaths: () => ["Notes/One.md"],
    getResearchMode: () => "instant",
    getAttachedContextPaths: () => state.attachedContextPaths,
    getActiveFilePath: () => undefined,
    shouldIncludeActiveFileContext: () => false,
    isRunning: () => state.running,
    getContextWindowUsage: () => state.contextWindowUsage,
    getSearchUnavailableMessage: () => state.searchUnavailableMessage,
    t,
    onSubmit: () => {},
    onStop: () => {},
    onOpenContextPicker: () => {},
    onRemoveContextPath: () => {},
    onUpdateModel: () => {},
    onUpdateIndex: () => {},
    onUpdateContextMode: () => {},
    onUpdateSearchMode: () => {},
    onUpdateResearchMode: () => {},
    ...overrides,
  });

  const redisplay = (): void => {
    container.empty();
    controller.render(container);
  };

  const query = <T extends HTMLElement>(selector: string): T => {
    const element = container.querySelector<T>(selector);
    if (!element) throw new Error(`missing element: ${selector}`);
    return element;
  };

  controller.render(container);

  return {
    controller,
    redisplay,
    state,
    textarea: () => query<HTMLTextAreaElement>("textarea.attest-chat__input"),
    submitButton: () => query<HTMLButtonElement>("button.attest-chat__submit"),
    modelButton: () => query<HTMLButtonElement>("button.attest-chat__dropdown--model"),
    attachButton: () => query<HTMLButtonElement>("button.attest-chat__icon-button"),
    contextIndicator: () => query(".attest-chat__context-indicator"),
  };
}

beforeEach(() => {
  container = createContainer();
});

afterEach(() => {
  resetDom();
});

describe("chat composer redisplay", () => {
  it("restores the draft question into the freshly rendered textarea", () => {
    const harness = createComposer();
    harness.controller.setQuestionInput("half written question");

    harness.redisplay();

    expect(harness.textarea().value).toBe("half written question");
    expect(harness.controller.getQuestionInput()).toBe("half written question");
  });

  it("re-disables the form when a run is still active", () => {
    const harness = createComposer();
    harness.state.running = true;
    harness.controller.setFormRunning(true);

    harness.redisplay();

    expect(harness.textarea().disabled).toBe(true);
    expect(harness.modelButton().disabled).toBe(true);
    expect(harness.attachButton().disabled).toBe(true);
    expect(harness.submitButton().dataset.mode).toBe("stop");
    expect(harness.submitButton().getAttribute("data-icon")).toBe("square");
    expect(harness.submitButton().disabled).toBe(false);
  });

  it("renders an idle, enabled form when no run is active", () => {
    const harness = createComposer();

    harness.redisplay();

    expect(harness.textarea().disabled).toBe(false);
    expect(harness.modelButton().disabled).toBe(false);
    expect(harness.submitButton().dataset.mode).toBe("ask");
    expect(harness.submitButton().getAttribute("data-icon")).toBe("arrow-up");
  });

  it("keeps the attached context chips after redisplay", () => {
    const harness = createComposer();
    harness.state.attachedContextPaths = ["Notes/One.md", "Folder/"];

    harness.redisplay();

    const names = Array.from(
      container.querySelectorAll(".attest-chat__attachment-name"),
      (element) => element.textContent,
    );
    expect(names).toEqual(["One.md", "Folder"]);
  });

  it("shows the included active file as a non-removable attachment", () => {
    createComposer({
      getActiveFilePath: () => "Notes/Active.md",
      shouldIncludeActiveFileContext: () => true,
    });

    const chip = container.querySelector<HTMLElement>(".attest-chat__attachment");
    expect(chip?.classList.contains("attest-chat__attachment--active-file")).toBe(true);
    expect(chip?.getAttribute("title")).toBe(
      "Active file (included automatically): Notes/Active.md",
    );
    expect(
      Array.from(
        container.querySelectorAll(".attest-chat__attachment-name"),
        (element) => element.textContent,
      ),
    ).toEqual(["Active.md"]);
    expect(container.querySelectorAll(".attest-chat__attachment button")).toHaveLength(0);
    expect(
      container
        .querySelector(".attest-chat__dropdown--context-mode")
        ?.parentElement?.classList.contains("is-hidden"),
    ).toBe(false);
  });

  it("keeps a manually attached active file removable", () => {
    const onRemoveContextPath = vi.fn();
    createComposer({
      getAttachedContextPaths: () => ["Notes/Active.md"],
      getActiveFilePath: () => "Notes/Active.md",
      shouldIncludeActiveFileContext: () => true,
      onRemoveContextPath,
    });

    const removeButton = container.querySelector<HTMLButtonElement>(
      ".attest-chat__attachment button",
    );
    const chip = container.querySelector<HTMLElement>(".attest-chat__attachment");
    expect(chip?.classList.contains("attest-chat__attachment--active-file")).toBe(false);
    expect(chip?.getAttribute("title")).toBe("Notes/Active.md");
    expect(removeButton).not.toBeNull();
    removeButton?.click();

    expect(onRemoveContextPath).toHaveBeenCalledWith("Notes/Active.md");
  });

  it("does not show an unsupported active file as an attachment", () => {
    createComposer({
      getActiveFilePath: () => "Images/Active.png",
      shouldIncludeActiveFileContext: () => true,
    });

    expect(container.querySelectorAll(".attest-chat__attachment-name")).toHaveLength(0);
    expect(
      container
        .querySelector(".attest-chat__dropdown--context-mode")
        ?.parentElement?.classList.contains("is-hidden"),
    ).toBe(true);
  });
});

describe("chat composer run state", () => {
  it("switches the submit button between ask and stop", () => {
    const onSubmit = vi.fn();
    const onStop = vi.fn();
    const harness = createComposer({ onSubmit, onStop });

    harness.submitButton().click();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onStop).not.toHaveBeenCalled();

    harness.state.running = true;
    harness.controller.setFormRunning(true);
    harness.submitButton().click();

    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("re-enables the textarea and controls when the run finishes", () => {
    const harness = createComposer();
    harness.state.running = true;
    harness.controller.setFormRunning(true);

    harness.state.running = false;
    harness.controller.setFormRunning(false);

    expect(harness.textarea().disabled).toBe(false);
    expect(harness.modelButton().disabled).toBe(false);
    expect(harness.submitButton().dataset.mode).toBe("ask");
    expect(harness.submitButton().getAttribute("aria-label")).toBe("Ask");
    expect(harness.submitButton().getAttribute("title")).toBeNull();
    expect(harness.submitButton().parentElement?.getAttribute("title")).toBeNull();
  });

  it("shows a single tooltip source when submitting is unavailable", () => {
    const harness = createComposer();
    harness.state.searchUnavailableMessage = "Enable web search";
    harness.controller.updateSubmitAvailability();

    const submitButton = harness.submitButton();
    expect(submitButton.disabled).toBe(true);
    expect(submitButton.getAttribute("title")).toBeNull();
    expect(submitButton.parentElement?.getAttribute("title")).toBeNull();
    expect(submitButton.getAttribute("aria-label")).toBe("Enable web search");
  });

  it("locks the submit button while the stop request is pending", () => {
    const harness = createComposer();
    harness.state.running = true;
    harness.controller.setFormRunning(true);

    harness.controller.setStopping();

    expect(harness.submitButton().disabled).toBe(true);
    expect(harness.submitButton().getAttribute("data-icon")).toBe("loader");
  });

  it("blocks submitting while search is unavailable and explains why", () => {
    const harness = createComposer();
    harness.state.searchUnavailableMessage = "No index is ready";

    harness.controller.updateSubmitAvailability();

    expect(harness.submitButton().disabled).toBe(true);
    expect(harness.submitButton().getAttribute("aria-label")).toBe("No index is ready");

    harness.state.searchUnavailableMessage = null;
    harness.controller.updateSubmitAvailability();

    expect(harness.submitButton().disabled).toBe(false);
    expect(harness.submitButton().getAttribute("aria-label")).toBe("Ask");
  });

  it("reports the context-window usage on the indicator", () => {
    const harness = createComposer();
    harness.state.contextWindowUsage = { estimatedTokens: 950, limitTokens: 1000 };

    harness.controller.updateSubmitAvailability();

    const indicator = harness.contextIndicator();
    expect(indicator.style.getPropertyValue("--attest-context-used")).toBe("95%");
    expect(indicator.classList.contains("is-warning")).toBe(true);

    harness.state.contextWindowUsage = null;
    harness.controller.updateSubmitAvailability();

    expect(indicator.style.getPropertyValue("--attest-context-used")).toBe("0%");
    expect(indicator.getAttribute("title")).toBe("Unknown model context window size");
  });
});

describe("chat composer input events", () => {
  it("refreshes submit availability when the question changes", () => {
    const harness = createComposer();
    harness.state.searchUnavailableMessage = "No index is ready";

    harness.textarea().value = "typed";
    harness.textarea().dispatchEvent(new Event("input"));

    expect(harness.submitButton().disabled).toBe(true);
  });

  it("submits on Enter and leaves Shift+Enter to the textarea", () => {
    const onSubmit = vi.fn();
    const harness = createComposer({ onSubmit });

    const enterEvent = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    harness.textarea().dispatchEvent(enterEvent);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(enterEvent.defaultPrevented).toBe(true);

    const shiftEnterEvent = new KeyboardEvent("keydown", {
      key: "Enter",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    harness.textarea().dispatchEvent(shiftEnterEvent);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(shiftEnterEvent.defaultPrevented).toBe(false);
  });

  it("ignores Enter while an IME composition is active", () => {
    const onSubmit = vi.fn();
    const harness = createComposer({ onSubmit });

    const composingEvent = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(composingEvent, "isComposing", { value: true });
    harness.textarea().dispatchEvent(composingEvent);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(composingEvent.defaultPrevented).toBe(false);
  });

  it("styles a dropdown menu before it is positioned", () => {
    const harness = createComposer();
    const classesWhenPlaced: string[] = [];
    const show = Menu.prototype.showAtPosition;
    vi.spyOn(Menu.prototype, "showAtPosition").mockImplementation(function (
      this: Menu,
      position: { x: number; y: number },
    ) {
      classesWhenPlaced.push((this as unknown as { dom: HTMLElement }).dom.className);
      return show.call(this, position);
    });

    harness.modelButton().click();
    container
      .querySelector<HTMLButtonElement>("button.attest-chat__dropdown--research-mode")
      ?.click();

    expect(classesWhenPlaced).toHaveLength(2);
    expect(classesWhenPlaced[0]).toContain("attest-chat__menu");
    expect(classesWhenPlaced[1]).toContain("attest-chat__research-menu");
  });
});
