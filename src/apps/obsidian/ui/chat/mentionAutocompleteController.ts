import { getMentionCandidates, MentionCandidate } from "./mentionAutocomplete";

export interface MentionAutocompleteHandle {
  update(): void;
  handleKeydown(event: KeyboardEvent): boolean;
}

/** Manages the @-mention popup attached to the composer textarea. */
export function createMentionAutocomplete(
  containerEl: HTMLElement,
  textareaEl: HTMLTextAreaElement,
  contextFilePaths: string[],
): MentionAutocompleteHandle {
  const autocompleteEl = containerEl.createDiv({
    cls: "ixplorer-chat__mention-autocomplete is-hidden",
    attr: { role: "listbox" },
  });
  let candidates: MentionCandidate[] = [];
  let activeIndex = 0;
  let mentionStart = -1;

  const hide = (): void => {
    autocompleteEl.addClass("is-hidden");
    candidates = [];
    mentionStart = -1;
    activeIndex = 0;
  };

  const insert = (candidate: MentionCandidate): void => {
    const cursor = textareaEl.selectionStart ?? textareaEl.value.length;
    const before = textareaEl.value.slice(0, mentionStart);
    const after = textareaEl.value.slice(cursor);
    const inserted = `@${candidate.insertText}`;
    textareaEl.value = `${before}${inserted} ${after}`;
    const nextCursor = before.length + inserted.length + 1;
    textareaEl.setSelectionRange(nextCursor, nextCursor);
    textareaEl.dispatchEvent(new Event("input"));
    textareaEl.focus();
    hide();
  };

  const render = (): void => {
    autocompleteEl.empty();
    if (candidates.length === 0) {
      hide();
      return;
    }

    autocompleteEl.removeClass("is-hidden");
    candidates.forEach((candidate, index) => {
      const item = autocompleteEl.createEl("button", {
        cls: `ixplorer-chat__mention-option${index === activeIndex ? " is-active" : ""}`,
        text: candidate.label,
        attr: {
          type: "button",
          role: "option",
          "aria-selected": String(index === activeIndex),
        },
      });
      item.addEventListener("mousedown", (event) => {
        event.preventDefault();
        insert(candidate);
      });
    });
  };

  const update = (): void => {
    const cursor = textareaEl.selectionStart ?? textareaEl.value.length;
    const beforeCursor = textareaEl.value.slice(0, cursor);
    const atIndex = beforeCursor.lastIndexOf("@");

    if (atIndex === -1) {
      hide();
      return;
    }

    const token = beforeCursor.slice(atIndex + 1);
    if (/\n/.test(token) || /\s/.test(token)) {
      hide();
      return;
    }

    mentionStart = atIndex;
    candidates = getMentionCandidates(token.toLowerCase(), contextFilePaths);
    activeIndex = 0;
    render();
  };

  const handleKeydown = (event: KeyboardEvent): boolean => {
    if (autocompleteEl.hasClass("is-hidden") || candidates.length === 0) {
      return false;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      hide();
      return true;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      activeIndex = Math.min(candidates.length - 1, activeIndex + 1);
      render();
      return true;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      activeIndex = Math.max(0, activeIndex - 1);
      render();
      return true;
    }

    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      insert(candidates[activeIndex]);
      return true;
    }

    return false;
  };

  return { update, handleKeydown };
}
