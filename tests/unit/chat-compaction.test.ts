import { describe, expect, it } from "vitest";

import {
  buildCompactionMessages,
  chatHistoryForPrompt,
  compactChatMessages,
  fallbackCompactionSummary,
  shouldCompactForContext,
  summarizeCompactionWithModel,
} from "@application/use-cases/chat";
import { markdownSource, retrieved, webSource } from "../helpers/factories";
import { ChatDisplayMessage } from "@core/conversation";

describe("ChatCompaction", () => {
  it("compacts old messages while preserving the two most recent turns for prompt history", () => {
    const messages = [
      user("Goal: compare local and web search. See Notes/Plan.md"),
      assistant("Use the index first.", [
        retrieved("local-1", markdownSource("Notes/Plan.md"), "Local"),
      ]),
      user("Decision: enable web search for current releases."),
      assistant("Use freshness policy [web:https://example.com].", [
        retrieved("web:https://example.com", webSource("https://example.com"), "Web"),
      ]),
      user("What changed next?"),
      assistant("We need follow-up evidence."),
      user("Continue."),
    ];

    const result = compactChatMessages(messages, {
      summary: {
        userGoals: ["Compare local and web search"],
        decisions: ["Use the index first"],
        unresolvedQuestions: ["What changed next?"],
        citedSourcesAlreadyUsed: ["custom-ref"],
      },
      now: () => new Date("2026-06-10T10:00:00.000Z"),
    });

    expect(result.changed).toBe(true);
    expect(result.messages.filter((message) => message.kind === "compact-summary")).toHaveLength(1);
    expect(
      result.messages.filter((message) => message.compacted && message.kind !== "compact-summary"),
    ).toHaveLength(3);
    expect(
      result.messages
        .filter((message) => message.kind !== "compact-summary")
        .map((message) => message.content),
    ).toEqual(messages.map((message) => message.content));
    expect(chatHistoryForPrompt(result.messages).map((message) => message.content)).toEqual([
      expect.stringContaining('"userGoals"'),
      "Use freshness policy [web:https://example.com].",
      "What changed next?",
      "We need follow-up evidence.",
      "Continue.",
    ]);
  });

  it("merges a repeat compaction into one summary marker", () => {
    const first = compactChatMessages(
      [
        user("Old goal"),
        assistant("Old answer"),
        user("Recent one"),
        assistant("Recent answer"),
        user("Recent two"),
      ],
      {
        summary: {
          userGoals: ["Old goal"],
          decisions: [],
          unresolvedQuestions: [],
          citedSourcesAlreadyUsed: ["Notes/A.md"],
        },
        now: () => new Date("2026-06-10T10:00:00.000Z"),
      },
    );
    const second = compactChatMessages(
      [...first.messages, assistant("Another answer"), user("Newest")],
      {
        summary: {
          userGoals: ["Newest goal"],
          decisions: ["New decision"],
          unresolvedQuestions: [],
          citedSourcesAlreadyUsed: ["Notes/B.md"],
        },
        now: () => new Date("2026-06-10T10:05:00.000Z"),
      },
    );

    expect(second.messages.filter((message) => message.kind === "compact-summary")).toHaveLength(1);
    const marker = second.messages.find((message) => message.kind === "compact-summary");
    expect(marker?.compactSummary).toMatchObject({
      userGoals: ["Old goal", "Newest goal"],
      decisions: ["New decision"],
      citedSourcesAlreadyUsed: ["Notes/A.md", "Notes/B.md"],
    });
  });

  it("extracts fallback references from old evidence, paths, and urls", () => {
    const summary = fallbackCompactionSummary([
      user("Read Notes/Plan.md and https://example.com/spec."),
      assistant("Answer", [
        retrieved("local-1", markdownSource("Notes/Plan.md"), "Local"),
        retrieved("web:https://example.com/spec", webSource("https://example.com/spec"), "Web"),
      ]),
    ]);

    expect(summary.citedSourcesAlreadyUsed).toEqual([
      "local-1: Notes/Plan.md",
      "web:https://example.com/spec: Example",
      "Notes/Plan.md",
      "https://example.com/spec",
    ]);
  });

  it("detects when compaction is required by context limit", () => {
    const messages = buildCompactionMessages("Long ".repeat(200), "Recent question");

    expect(
      shouldCompactForContext({
        question: "Next?",
        messages,
        contextLimitTokens: 100,
        reservedOutputTokens: 10,
      }),
    ).toBe(true);
  });

  it("does not compact short histories or histories without a context limit", () => {
    const messages = buildCompactionMessages("Old", "Recent").slice(1);

    expect(compactChatMessages(messages, { summary: fallbackCompactionSummary(messages) })).toEqual(
      {
        changed: false,
        compactedCount: 0,
        messages,
      },
    );
    expect(shouldCompactForContext({ question: "Next?", messages })).toBe(false);
  });

  it("retries an invalid model summary and retains referenced sources from fallback history", async () => {
    let calls = 0;
    const chatModel = {
      async *streamChat() {
        calls += 1;
        yield {
          content:
            calls === 1
              ? "This is not JSON"
              : 'prefix {"userGoals":["  Goal  ",3],"decisions":["Decision"],"unresolvedQuestions":[],"citedSourcesAlreadyUsed":["New source"]} suffix',
          isComplete: true,
        };
      },
    };

    const summary = await summarizeCompactionWithModel({
      chatModel: chatModel as never,
      model: "test-model",
      messages: [user("Read Notes/Plan.md")],
      existingSummary: {
        userGoals: ["Earlier goal"],
        decisions: [],
        unresolvedQuestions: [],
        citedSourcesAlreadyUsed: ["Notes/Existing.md"],
      },
    });

    expect(calls).toBe(2);
    expect(summary).toEqual({
      userGoals: ["Goal"],
      decisions: ["Decision"],
      unresolvedQuestions: [],
      citedSourcesAlreadyUsed: ["New source", "Notes/Existing.md", "Notes/Plan.md"],
    });
  });

  it("includes assistant reasoning trace and tool results in prompt history", () => {
    const messages: ChatDisplayMessage[] = [
      user("Find relevant notes."),
      {
        ...assistant("The note says to use Attest."),
        researchProgress: {
          phase: "complete",
          disclosure: "auto",
          view: "expanded",
          reasoning: {
            phase: "complete",
            segments: [{ id: "summary-1", kind: "summary", content: "Need local evidence." }],
          },
          checkpoints: [
            { id: "checkpoint-1", round: 1, content: "Searching the index", status: "complete" },
          ],
          chain: [
            { kind: "reasoning", segmentId: "reason-1", content: "Search before answering." },
            {
              kind: "tool-call",
              id: "tool-1",
              name: "search_index",
              label: "Search index",
              status: "complete",
              resultSummary: "1 result",
              args: { query: "Attest" },
              resultJson: '{"results":[{"path":"Notes/Attest.md","text":"Use Attest."}]}',
              children: [
                {
                  kind: "tool-call",
                  id: "tool-2",
                  name: "read_note",
                  label: "Read note",
                  status: "complete",
                  args: { path: "Notes/Attest.md" },
                  resultJson: '{"content":"Use Attest."}',
                },
              ],
            },
          ],
        },
      },
    ];

    const [, assistantHistory] = chatHistoryForPrompt(messages);

    expect(assistantHistory.content).toContain("The note says to use Attest.");
    expect(assistantHistory.content).toContain("Research trace:");
    expect(assistantHistory.content).toContain("Reasoning summary: Need local evidence.");
    expect(assistantHistory.content).toContain("Reasoning: Search before answering.");
    expect(assistantHistory.content).toContain("Checkpoint round 1: Searching the index");
    expect(assistantHistory.content).toContain(
      'Tool search_index [complete] Search index; args: {"query":"Attest"}; summary: 1 result; result: {"results":[{"path":"Notes/Attest.md","text":"Use Attest."}]}',
    );
    expect(assistantHistory.content).toContain(
      'Child tool read_note [complete] Read note; args: {"path":"Notes/Attest.md"}; result: {"content":"Use Attest."}',
    );
  });
});

function user(content: string): ChatDisplayMessage {
  return { role: "user", content, createdAt: "2026-06-10T10:00:00.000Z" };
}

function assistant(content: string, evidence?: ChatDisplayMessage["evidence"]): ChatDisplayMessage {
  return {
    role: "assistant",
    content,
    createdAt: "2026-06-10T10:00:00.000Z",
    ...(evidence ? { evidence } : {}),
  };
}
