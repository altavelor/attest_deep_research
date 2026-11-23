// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTranslator } from "@adapters/i18n";
import { renderClarificationCard } from "@apps/obsidian/ui/chat/clarificationCard";
import type { ChatDisplayMessage } from "@core/conversation";
import { installObsidianDomHelpers, resetDom } from "../../support/domHarness";

const t = createTranslator("en").t;
const AT = "2026-10-27T08:00:00.000Z";
const asked: ChatDisplayMessage = {
  role: "assistant",
  content: "",
  createdAt: AT,
  answer: {
    question: "Should I move to SQLite?",
    answer: "",
    citations: [],
    followUpQuestions: [],
    createdAt: AT,
    clarification: {
      questions: [
        { questionId: "question-1", prompt: "Which database now?", suggestions: ["Postgres"] },
        { questionId: "question-2", prompt: "How large?", suggestions: [] },
      ],
    },
  },
};

beforeEach(() => installObsidianDomHelpers());
afterEach(() => resetDom());

function render(messages: ChatDisplayMessage[], running = false, translate = t) {
  const onReply = vi.fn();
  const host = document.createElement("div");
  renderClarificationCard(host, asked, messages, { t: translate, running, onReply });
  const button = (label: string) =>
    [...host.querySelectorAll("button")].find((el) => el.textContent === label);
  return { host, onReply, button };
}

describe("clarification card", () => {
  it("sends the chip answer and marks the unanswered question in one message", () => {
    const { onReply, button } = render([asked]);
    button("Postgres")!.click();
    button("Send answers")!.click();
    button("Send answers")!.click();
    expect(onReply).toHaveBeenCalledTimes(1);
    expect(onReply).toHaveBeenCalledWith(
      "Answers to the clarifying questions:\n\n1. Which database now?\nAnswer: Postgres\n\n" +
        "2. How large?\nAnswer: Not answered",
      { answers: { "question-1": "Postgres" }, skipped: false },
    );
  });

  it("asks to proceed on stated assumptions", () => {
    const { onReply, button } = render([asked]);
    button("Answer without clarification")!.click();
    expect(onReply).toHaveBeenCalledWith(t("chat.clarification.skipMessage"), {
      answers: {},
      skipped: true,
    });
  });

  it("is read-only with the stored answers once a reply follows, and while a run is active", () => {
    const reply: ChatDisplayMessage = {
      role: "user",
      createdAt: AT,
      content: "Answers to the clarifying questions:\n\n1. Which database now?\nAnswer: Files",
      clarificationReply: { answers: { "question-1": "Files" }, skipped: false },
    };
    const after = render([asked, reply], false, createTranslator("ru").t);
    expect(after.host.querySelector("textarea")).toBeNull();
    expect(after.host.querySelector("button")).toBeNull();
    expect(after.host.textContent).toContain("Files");
    expect(render([asked], true).host.querySelector("textarea")).toBeNull();
    const typed = render([asked, { role: "user", createdAt: AT, content: "Files, I think" }]);
    expect(typed.host.textContent).not.toContain("Files");
    expect(typed.host.textContent).toContain("Which database now?");
  });
});
