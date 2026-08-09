// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMentionAutocomplete } from "@apps/obsidian/ui/chat/mentionAutocompleteController";
import { createContainer, installObsidianDomHelpers, resetDom } from "../helpers/domHarness";

describe("mention autocomplete controller", () => {
  beforeEach(installObsidianDomHelpers);
  afterEach(resetDom);

  it("filters candidates, supports keyboard navigation, and inserts the selected path", () => {
    const container = createContainer();
    const textarea = container.createEl("textarea");
    const onInput = vi.fn();
    textarea.addEventListener("input", onInput);
    textarea.value = "Read @pl";
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    const autocomplete = createMentionAutocomplete(container, textarea, [
      "Notes/Plan.md",
      "Notes/Playbook.md",
      "Archive/Old.md",
    ]);

    autocomplete.update();
    expect(container.querySelectorAll(".ixplorer-chat__mention-option")).toHaveLength(2);
    expect(autocomplete.handleKeydown(new KeyboardEvent("keydown", { key: "ArrowDown" }))).toBe(
      true,
    );
    expect(autocomplete.handleKeydown(new KeyboardEvent("keydown", { key: "Enter" }))).toBe(true);
    expect(textarea.value).toBe("Read @Notes/Playbook.md ");
    expect(onInput).toHaveBeenCalledTimes(1);
    expect(
      container
        .querySelector(".ixplorer-chat__mention-autocomplete")
        ?.classList.contains("is-hidden"),
    ).toBe(true);
  });

  it("hides on invalid mention boundaries and allows Escape to dismiss a visible list", () => {
    const container = createContainer();
    const textarea = container.createEl("textarea");
    const autocomplete = createMentionAutocomplete(container, textarea, ["Notes/Plan.md"]);

    textarea.value = "Question @plan";
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    autocomplete.update();
    expect(autocomplete.handleKeydown(new KeyboardEvent("keydown", { key: "Escape" }))).toBe(true);
    expect(autocomplete.handleKeydown(new KeyboardEvent("keydown", { key: "Enter" }))).toBe(false);

    textarea.value = "Question @plan more";
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    autocomplete.update();
    expect(
      container
        .querySelector(".ixplorer-chat__mention-autocomplete")
        ?.classList.contains("is-hidden"),
    ).toBe(true);
  });
});
