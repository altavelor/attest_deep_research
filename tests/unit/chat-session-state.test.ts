import { describe, expect, it } from "vitest";

import {
  MAX_CONCURRENT_CHAT_SESSIONS,
  chatHistoryActivity,
  isChatSessionStatus,
  isInterruptionReason,
  isNonTerminalChatSessionStatus,
  isTerminalChatSessionStatus,
  nextRunStatus,
  normalizeStaleRunState,
  parseSavedChatRunState,
} from "@core/chat/chatSession";
import type { ChatSessionStatus } from "@core/chat/chatSession";

describe("chat session status", () => {
  it("classifies non-terminal and terminal statuses", () => {
    const nonTerminal: ChatSessionStatus[] = ["queued", "running", "stopping"];
    const terminal: ChatSessionStatus[] = ["completed", "failed", "interrupted"];

    expect(nonTerminal.every(isNonTerminalChatSessionStatus)).toBe(true);
    expect([...terminal, "idle" as const].some(isNonTerminalChatSessionStatus)).toBe(false);
    expect(terminal.every(isTerminalChatSessionStatus)).toBe(true);
    expect(isTerminalChatSessionStatus("idle")).toBe(false);
  });

  it("recognizes only the declared statuses and interruption reasons", () => {
    expect(isChatSessionStatus("running")).toBe(true);
    expect(isChatSessionStatus("paused")).toBe(false);
    expect(isInterruptionReason("crash-recovery")).toBe(true);
    expect(isInterruptionReason("network")).toBe(false);
  });
});

describe("run slot policy", () => {
  it("queues a run only once every slot is occupied", () => {
    expect(nextRunStatus(0)).toBe("running");
    expect(nextRunStatus(MAX_CONCURRENT_CHAT_SESSIONS - 1)).toBe("running");
    expect(nextRunStatus(MAX_CONCURRENT_CHAT_SESSIONS)).toBe("queued");
    expect(nextRunStatus(MAX_CONCURRENT_CHAT_SESSIONS + 3)).toBe("queued");
  });
});

describe("chat history activity", () => {
  it("counts running sessions and unread completions independently", () => {
    expect(
      chatHistoryActivity([
        { status: "running", unreadCompletion: false },
        { status: "queued", unreadCompletion: false },
        { status: "stopping", unreadCompletion: false },
        { status: "completed", unreadCompletion: true },
        { status: "interrupted", unreadCompletion: false },
      ]),
    ).toEqual({ runningCount: 1, unreadCompletedCount: 1 });
    expect(chatHistoryActivity([])).toEqual({ runningCount: 0, unreadCompletedCount: 0 });
  });
});

describe("stale run normalization", () => {
  it("converts a non-terminal run into a crash-recovery interruption", () => {
    expect(
      normalizeStaleRunState(
        { runId: "r1", startedAt: "2026-01-01T00:00:00.000Z", status: "running" },
        "2026-01-01T01:00:00.000Z",
      ),
    ).toEqual({
      runId: "r1",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T01:00:00.000Z",
      status: "interrupted",
      interruptionReason: "crash-recovery",
    });
  });

  it("leaves a terminal run and an absent run untouched", () => {
    const completed = {
      runId: "r1",
      startedAt: "2026-01-01T00:00:00.000Z",
      status: "completed",
    } as const;

    expect(normalizeStaleRunState(completed, "2026-01-01T01:00:00.000Z")).toBe(completed);
    expect(normalizeStaleRunState(undefined, "2026-01-01T01:00:00.000Z")).toBeUndefined();
  });
});

describe("persisted run metadata parsing", () => {
  it("accepts well-formed run states", () => {
    expect(
      parseSavedChatRunState({
        runId: "r1",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:01:00.000Z",
        status: "completed",
      }),
    ).toEqual({
      runId: "r1",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:01:00.000Z",
      status: "completed",
    });
    expect(
      parseSavedChatRunState({
        runId: "r1",
        startedAt: "2026-01-01T00:00:00.000Z",
        status: "interrupted",
        interruptionReason: "plugin-unload",
      }),
    ).toMatchObject({ status: "interrupted", interruptionReason: "plugin-unload" });
  });

  it("discards malformed metadata instead of trusting it", () => {
    const malformed: unknown[] = [
      null,
      "run",
      {},
      { runId: "", startedAt: "2026-01-01T00:00:00.000Z", status: "running" },
      { runId: "r1", startedAt: 5, status: "running" },
      { runId: "r1", startedAt: "2026-01-01T00:00:00.000Z", status: "idle" },
      { runId: "r1", startedAt: "2026-01-01T00:00:00.000Z", status: "paused" },
      { runId: "r1", startedAt: "2026-01-01T00:00:00.000Z", completedAt: 7, status: "completed" },
      { runId: "r1", startedAt: "2026-01-01T00:00:00.000Z", status: "interrupted" },
      {
        runId: "r1",
        startedAt: "2026-01-01T00:00:00.000Z",
        status: "interrupted",
        interruptionReason: "network",
      },
    ];

    expect(malformed.map(parseSavedChatRunState)).toEqual(malformed.map(() => undefined));
  });
});
