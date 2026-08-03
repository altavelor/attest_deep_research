// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

let container: HTMLElement;

function createComposer(overrides: Partial<ChatComposerControllerOptions> = {}): ComposerHarness {
  const state = {
    running: false,
    attachedContextPaths: [] as string[],
    searchUnavailableMessage: null as string | null,
    contextWindowUsage: null as ContextWindowUsage | null,
  };

  const controller = new ChatComposerController({
    getSettings: () => ({ chatModelProfileId: "model-a", searchMode: "indexOnly" }),
    getAvailableModels: () => [
      { id: "model-a", name: "Model A", supportsAgentMode: true },
      { id: "model-b", name: "Model B" },
    ],
    getAvailableIndexes: () => [{ id: "index-a", name: "Index A", isIndexed: true }],
    getContextFilePaths: () => ["Notes/One.md"],
    getResearchMode: () => "instant",
    getAttachedContextPaths: () => state.attachedContextPaths,
    isRunning: () => state.running,
    getContextWindowUsage: () => state.contextWindowUsage,
    getSearchUnavailableMessage: () => state.searchUnavailableMessage,
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
    textarea: () => query<HTMLTextAreaElement>("textarea.ixplorer-chat__input"),
    submitButton: () => query<HTMLButtonElement>("button.ixplorer-chat__submit"),
    modelButton: () => query<HTMLButtonElement>("button.ixplorer-chat__dropdown--model"),
    attachButton: () => query<HTMLButtonElement>("button.ixplorer-chat__icon-button"),
    contextIndicator: () => query(".ixplorer-chat__context-indicator"),
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
      container.querySelectorAll(".ixplorer-chat__attachment-name"),
      (element) => element.textContent,
    );
    expect(names).toEqual(["One.md", "Folder"]);
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
    expect(harness.submitButton().getAttribute("title")).toBe("Ask");
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
    expect(harness.submitButton().getAttribute("aria-label")).toBe(
      "Ask unavailable: No index is ready",
    );

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
    expect(indicator.style.getPropertyValue("--ixplorer-context-used")).toBe("95%");
    expect(indicator.classList.contains("is-warning")).toBe(true);

    harness.state.contextWindowUsage = null;
    harness.controller.updateSubmitAvailability();

    expect(indicator.style.getPropertyValue("--ixplorer-context-used")).toBe("0%");
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

  it("submits on Enter and inserts a newline on Shift+Enter", () => {
    const onSubmit = vi.fn();
    const harness = createComposer({ onSubmit });

    harness
      .textarea()
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    expect(onSubmit).toHaveBeenCalledTimes(1);

    harness.textarea().dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
