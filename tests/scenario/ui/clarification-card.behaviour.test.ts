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

function render(messages: ChatDisplayMessage[], running = false) {
  const onReply = vi.fn();
  const host = document.createElement("div");
  renderClarificationCard(host, asked, messages, { t, running, onReply });
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
    );
  });

  it("asks to proceed on stated assumptions", () => {
    const { onReply, button } = render([asked]);
    button("Answer without clarification")!.click();
    expect(onReply).toHaveBeenCalledWith(t("chat.clarification.skipMessage"));
  });

  it("is read-only with the given answers once a reply follows, and while a run is active", () => {
    const reply: ChatDisplayMessage = {
      role: "user",
      createdAt: AT,
      content:
        "Answers to the clarifying questions:\n\n1. Which database now?\nAnswer: Files\n\n" +
        "2. How large?\nAnswer: Not answered",
    };
    const after = render([asked, reply]);
    expect(after.host.querySelector("textarea")).toBeNull();
    expect(after.host.querySelector("button")).toBeNull();
    expect(after.host.textContent).toContain("Files");
    expect(render([asked], true).host.querySelector("textarea")).toBeNull();
  });
});
