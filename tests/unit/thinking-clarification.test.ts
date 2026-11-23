import { parseSavedChat } from "@core/chat/savedChat";
import { chatHistoryForPrompt } from "@application/use-cases/chat/ChatCompaction";
import {
  clarificationAnswersFromReply,
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

function savedWith(clarification: unknown) {
  return parseSavedChat({
    schemaVersion: 4,
    id: "chat-1",
    title: "Chat",
    createdAt: AT,
    updatedAt: AT,
    messages: [
      { role: "assistant", content: "", createdAt: AT, answer: { answer: "", clarification } },
    ],
    lastAnswer: null,
    attachedContextPaths: [],
    chatSettings: DOCUMENT_CHAT_SETTINGS,
  });
}

describe("Thinking clarification rules", () => {
  it("bounds tool questions to three and rejects input without a prompt", () => {
    const four = Array.from({ length: 4 }, (_, i) => ({ prompt: `Q${i}` }));
    const parsed = parseClarificationArguments({ questions: four });
    expect(parsed.ok && parsed.clarification.questions).toHaveLength(3);
    expect(parseClarificationArguments({ questions: [{ prompt: " " }] })).toEqual({
      ok: false,
      message: "Pass 1-3 questions, each with a non-empty prompt.",
    });
  });

  it("keeps a valid stored clarification and drops a malformed one with the message", () => {
    expect(savedWith(CLARIFICATION)?.messages[0]?.answer?.clarification).toEqual(CLARIFICATION);
    const dropped = savedWith({ questions: [{ questionId: "question-1", prompt: 7 }] });
    expect(dropped?.messages).toHaveLength(1);
    expect(dropped?.messages[0]?.answer).not.toHaveProperty("clarification");
  });

  it("formats a reply that marks unanswered questions and reads the answers back", () => {
    const reply = formatClarificationReply(CLARIFICATION, { "question-1": " Postgres " }, LABELS);
    expect(reply).toBe(
      "Answers:\n\n1. Which database?\nAnswer: Postgres\n\n2. How large?\nAnswer: Not answered",
    );
    expect(clarificationAnswersFromReply(CLARIFICATION, reply, LABELS)).toEqual({
      "question-1": "Postgres",
    });
    expect(clarificationAnswersFromReply(CLARIFICATION, "typed", LABELS)).toEqual({});
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
