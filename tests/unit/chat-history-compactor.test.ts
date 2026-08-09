import { describe, expect, it, vi } from "vitest";

import { takeNotices } from "../stubs/obsidian";
import { ChatHistoryCompactor } from "@apps/obsidian/ui/chat/research/ChatHistoryCompactor";
import { IxplorerError } from "@core/errors";
import type { ChatDisplayMessage } from "@core/conversation";

function message(role: "user" | "assistant", content: string): ChatDisplayMessage {
  return { role, content, createdAt: "2026-08-10T00:00:00.000Z" };
}

function harness(messages: ChatDisplayMessage[]) {
  let current = messages;
  const setMessages = vi.fn((next: ChatDisplayMessage[]) => {
    current = next;
  });
  const saveCurrentChat = vi.fn().mockResolvedValue(undefined);
  const setProgressStatus = vi.fn();
  const renderMessages = vi.fn();
  const summarizeChatHistoryForCompaction = vi.fn().mockResolvedValue({
    userGoals: ["Keep the decision"],
    decisions: [],
    unresolvedQuestions: [],
    citedSourcesAlreadyUsed: [],
  });
  const compactor = new ChatHistoryCompactor({
    getMessages: () => current,
    setMessages,
    getContextLimitTokens: () => 100,
    getReservedOutputTokens: () => 10,
    createResearchService: () => ({ summarizeChatHistoryForCompaction }) as never,
    saveCurrentChat,
    setProgressStatus,
    renderMessages,
    t: ((key: string) => key) as never,
  });
  return {
    compactor,
    get messages() {
      return current;
    },
    setMessages,
    saveCurrentChat,
    setProgressStatus,
    renderMessages,
    summarizeChatHistoryForCompaction,
  };
}

describe("ChatHistoryCompactor", () => {
  it("does not call the model when there are no messages eligible for compaction", async () => {
    takeNotices();
    const state = harness([message("user", "Only the current question")]);

    await expect(state.compactor.compactHistory({ automatic: false })).resolves.toBe(false);

    expect(state.summarizeChatHistoryForCompaction).not.toHaveBeenCalled();
    expect(state.setProgressStatus).toHaveBeenCalledWith("chat.compact.nothingToCompact");
    expect(takeNotices().map((notice) => notice.message)).toEqual([
      "chat.compact.nothingToCompact",
    ]);
  });

  it("adds an automatic status message, persists it, then replaces old history with a summary", async () => {
    const state = harness([
      message("user", "Old goal"),
      message("assistant", "Old answer"),
      message("user", "Recent question"),
      message("assistant", "Recent answer"),
      message("user", "Current question"),
    ]);

    await expect(state.compactor.compactHistory({ automatic: true })).resolves.toBe(true);

    expect(state.saveCurrentChat).toHaveBeenCalledTimes(2);
    expect(state.renderMessages).toHaveBeenCalledTimes(2);
    expect(state.messages.some((item) => item.kind === "compact-summary")).toBe(true);
    expect(state.setProgressStatus).toHaveBeenLastCalledWith("chat.compact.done");
  });

  it("keeps the history intact and shows a safe message when model summarization fails", async () => {
    takeNotices();
    const original = [
      message("user", "Old goal"),
      message("assistant", "Old answer"),
      message("user", "Recent question"),
      message("assistant", "Recent answer"),
      message("user", "Current question"),
    ];
    const state = harness(original);
    state.summarizeChatHistoryForCompaction.mockRejectedValueOnce(
      new IxplorerError({ code: "MODEL_PROVIDER_UNAVAILABLE", cause: new Error("offline") }),
    );

    await expect(state.compactor.compactHistory({ automatic: false })).resolves.toBe(false);

    expect(state.messages).toEqual(original);
    expect(state.saveCurrentChat).not.toHaveBeenCalled();
    expect(state.setProgressStatus).toHaveBeenLastCalledWith("offline");
    expect(takeNotices().map((notice) => notice.message)).toEqual(["offline"]);
  });
});
