// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTranslator } from "@adapters/i18n";
import { renderChatComposer } from "@apps/obsidian/ui/chat/ChatComposer";
import { installObsidianDomHelpers, resetDom } from "../helpers/domHarness";

const t = createTranslator("en").t;

function renderComposer(): HTMLTextAreaElement {
  const containerEl = document.body.appendChild(document.createElement("div"));
  return renderChatComposer(containerEl, {
    settings: {
      chatModelProfileId: "chat-1",
      searchMode: "indexAndWeb",
      indexProfileId: "index-1",
      contextMode: "include",
    },
    availableModels: [{ id: "chat-1", name: "chat-1" }],
    availableIndexes: [{ id: "index-1", name: "Default index" }],
    contextFilePaths: [],
    researchMode: "instant",
    t,
    onSubmit: () => {},
    onStop: () => {},
    onOpenContextPicker: () => {},
    onUpdateModel: () => {},
    onUpdateIndex: () => {},
    onUpdateContextMode: () => {},
    onUpdateSearchMode: () => {},
    onUpdateResearchMode: () => {},
  }).textareaEl;
}

describe("chat composer question field", () => {
  beforeEach(installObsidianDomHelpers);
  afterEach(resetDom);

  it("never pins a zero height when the leaf has not been laid out yet", () => {
    const textareaEl = renderComposer();

    expect(textareaEl.style.height).not.toBe("0px");
    expect(textareaEl.getAttribute("rows")).toBe("1");
  });

  it("keeps the field measurable after a resize arrives with no layout", () => {
    const textareaEl = renderComposer();

    textareaEl.dispatchEvent(new Event("input"));

    expect(textareaEl.style.height).not.toBe("0px");
  });
});
