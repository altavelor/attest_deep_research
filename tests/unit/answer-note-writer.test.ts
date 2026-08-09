import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";

import { AnswerNoteWriter } from "@apps/obsidian/ui/chat/research/AnswerNoteWriter";
import type { ResearchAnswer } from "@core/answer";

const answer: ResearchAnswer = {
  question: "Question",
  answer: "Answer",
  citations: [],
  followUpQuestions: [],
  createdAt: "2026-01-01T00:00:00.000Z",
};

function app(overrides: Record<string, unknown> = {}): App {
  return {
    vault: {
      getAbstractFileByPath: vi.fn(),
      getFolderByPath: vi.fn(),
      createFolder: vi.fn(async () => undefined),
      create: vi.fn(async () => undefined),
      append: vi.fn(async () => undefined),
    },
    workspace: {
      getActiveFile: vi.fn(() => null),
      openLinkText: vi.fn(async () => undefined),
    },
    ...overrides,
  } as unknown as App;
}

describe("AnswerNoteWriter", () => {
  it("creates a collision-safe note and its missing folder", async () => {
    const fakeApp = app();
    const vault = fakeApp.vault as unknown as Record<string, ReturnType<typeof vi.fn>>;
    vault.getAbstractFileByPath.mockReturnValueOnce({}).mockReturnValue(null);
    const writer = new AnswerNoteWriter(fakeApp, ((key: string) => key) as never);

    await writer.saveAnswerToNewNote(answer);

    expect(vault.createFolder).toHaveBeenCalledWith("Ixplorer");
    expect(vault.create).toHaveBeenCalledWith(expect.stringMatching(/-2\.md$/), expect.any(String));
  });

  it("does not append when there is no active note", async () => {
    const fakeApp = app();
    const writer = new AnswerNoteWriter(fakeApp, ((key: string) => key) as never);

    await writer.appendAnswerToActiveNote(answer);

    expect(fakeApp.vault.append).not.toHaveBeenCalled();
  });
});
