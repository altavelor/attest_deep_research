import { parseSavedChat } from "@core/chat/savedChat";
import { chatHistoryForPrompt } from "@application/use-cases/chat/ChatCompaction";
import {
  clarificationReplyOf,
  formatClarificationReply,
  parseClarificationArguments,
} from "@core/research";
import { DOCUMENT_CHAT_SETTINGS } from "../support/chatDocuments";

const AT = "2026-10-27T08:00:00.000Z";
const LABELS = { heading: "Answers:", answer: "Answer", unanswered: "Not answered" };
const CLARIFICATION = {
  questions: [
    { questionId: "question-1", prompt: "Which database?", suggestions: ["Postgres"] },
    { questionId: "question-2", prompt: "How large?", suggestions: [] },
  ],
};

function savedWith(clarification: unknown, clarificationReply?: unknown) {
  return parseSavedChat({
    schemaVersion: 4,
    id: "chat-1",
    title: "Chat",
    createdAt: AT,
    updatedAt: AT,
    messages: [
      { role: "assistant", content: "", createdAt: AT, answer: { answer: "", clarification } },
      { role: "user", content: "reply", createdAt: AT, clarificationReply },
    ],
    lastAnswer: null,
    attachedContextPaths: [],
    chatSettings: DOCUMENT_CHAT_SETTINGS,
  });
}

describe("Thinking clarification rules", () => {
  it("rejects the whole tool call when the count or any entry is invalid", () => {
    const failure = {
      ok: false,
      message:
        "Pass 1-3 questions, each with a non-empty prompt of at most 500 characters and at most " +
        "3 string suggestions of at most 200 characters.",
    };
    const three = Array.from({ length: 3 }, (_, i) => ({ prompt: `Q${i}` }));
    const parsed = parseClarificationArguments({ questions: three });
    expect(parsed.ok && parsed.clarification.questions).toHaveLength(3);
    expect(parseClarificationArguments({ questions: [...three, { prompt: "Q3" }] })).toEqual(
      failure,
    );
    expect(parseClarificationArguments({ questions: [{ prompt: "Q" }, { prompt: 7 }] })).toEqual(
      failure,
    );
    expect(parseClarificationArguments({ questions: [{ prompt: " " }] })).toEqual(failure);
    expect(
      parseClarificationArguments({ questions: [{ prompt: "Q", suggestions: ["a", 2] }] }),
    ).toEqual(failure);
  });

  it("keeps a valid stored clarification and reply and drops malformed ones with the message", () => {
    const reply = { answers: { "question-1": "Postgres" }, skipped: false };
    const kept = savedWith(CLARIFICATION, reply);
    expect(kept?.messages[0]?.answer?.clarification).toEqual(CLARIFICATION);
    expect(kept?.messages[1]?.clarificationReply).toEqual(reply);
    const dropped = savedWith(
      { questions: [{ questionId: "question-1", prompt: 7 }] },
      {
        answers: { "question-1": 7 },
        skipped: false,
      },
    );
    expect(dropped?.messages).toHaveLength(2);
    expect(dropped?.messages[0]?.answer).not.toHaveProperty("clarification");
    expect(dropped?.messages[1]).not.toHaveProperty("clarificationReply");
    expect(dropped?.messages[1]?.content).toBe("reply");
  });

  it("keeps trimmed answers structurally and formats them with unanswered questions marked", () => {
    const reply = clarificationReplyOf(CLARIFICATION, {
      "question-1": " Postgres ",
      "question-2": " ",
    });
    expect(reply).toEqual({ answers: { "question-1": "Postgres" }, skipped: false });
    expect(formatClarificationReply(CLARIFICATION, reply, LABELS)).toBe(
      "Answers:\n\n1. Which database?\nAnswer: Postgres\n\n2. How large?\nAnswer: Not answered",
    );
  });

  it("marks a clarification turn in the prompt history with its questions", () => {
    const [entry] = chatHistoryForPrompt([
      {
        role: "assistant",
        content: "",
        createdAt: AT,
        answer: { clarification: CLARIFICATION } as never,
      },
    ]);
    expect(entry).toMatchObject({ clarification: true });
    expect(entry!.content).toContain("1. Which database?");
  });
});
