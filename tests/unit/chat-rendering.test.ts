import {
  attachAnswerDetailsToLastAssistantMessage,
  completeAssistantCheckpoint,
  nextAssistantCheckpoint,
  messageMarkdownContent,
  nextAssistantMessage,
  nextAssistantReasoning,
  promoteAssistantCheckpoint,
  interruptLastAssistantProgress,
  nextChainToolCallStart,
  nextUserMessage,
  startAssistantProgress,
  shouldShowAnswerNoteActions,
  shouldShowDiagnosticAction,
  stripMessageDiagnostics,
} from "@core/conversation";
import {
  citationTarget,
  formatIndexingStatus,
  formatProgressPercent,
  messageDisplayContent,
} from "@apps/obsidian/ui/chat/conversationFormatting";
import {
  chatModelProfileLabel as selectedChatModelProfileLabel,
  createDefaultChatSettings,
  resolveChatSettings,
} from "@apps/obsidian/ui/chat/chatViewHelpers";
import { citationEvidence } from "@apps/obsidian/ui/chat/citations/citationEvidence";
import {
  filterSavedChatsByTab,
  shouldScrollSavedChatsList,
} from "@apps/obsidian/ui/chat/history/savedChatListState";
import { ContextDiagnostics } from "@core/diagnostics";
import { Citation } from "@core/model";
import { SourceReference } from "@core/model";

describe("chat rendering helpers", () => {
  it("creates a new chat from the configured new-chat defaults", () => {
    const settings = createDefaultChatSettings({
      getChatModelProfiles: () => [{ id: "model", name: "Model", supportsAgentMode: true }],
      getDefaultChatModelProfileId: () => "model",
      getIndexProfiles: () => [{ id: "index", name: "Index", isIndexed: true }],
      getDefaultIndexProfileId: () => "index",
      getDefaultSearchMode: () => "indexAndWeb",
      getDefaultResearchMode: () => "thinking",
    });

    expect(settings).toMatchObject({
      chatModelProfileId: "model",
      indexProfileId: "index",
      searchMode: "indexAndWeb",
      researchMode: "thinking",
    });
  });

  it("degrades a thinking default to instant for a model without agent mode", () => {
    expect(
      createDefaultChatSettings({
        getChatModelProfiles: () => [{ id: "model", name: "Model" }],
        getDefaultChatModelProfileId: () => "model",
        getIndexProfiles: () => [],
        getDefaultIndexProfileId: () => "",
        getDefaultSearchMode: () => "none",
        getDefaultResearchMode: () => "thinking",
      }).researchMode,
    ).toBe("instant");
  });

  it("restores saved research mode and defaults legacy chats to Instant", () => {
    const services = {
      getChatModelProfiles: () => [{ id: "model", name: "Model" }],
      getDefaultChatModelProfileId: () => "model",
      getIndexProfiles: () => [{ id: "index", name: "Index", isIndexed: true }],
      getDefaultIndexProfileId: () => "index",
      getDefaultSearchMode: () => "indexOnly" as const,
      getDefaultResearchMode: () => "instant" as const,
    };

    expect(
      resolveChatSettings(services, {
        chatModelProfileId: "model",
        indexProfileId: "index",
        searchMode: "indexOnly",
        researchMode: "thinking",
      }).researchMode,
    ).toBe("thinking");
    expect(
      resolveChatSettings(services, {
        chatModelProfileId: "model",
        indexProfileId: "index",
        searchMode: "indexOnly",
      }).researchMode,
    ).toBe("instant");
  });

  it("keeps included context paths on the sent user message", () => {
    const messages = nextUserMessage([], "Summarize this", ["Docs/one.md", "Docs/two.pdf"]);

    expect(messages).toEqual([
      {
        role: "user",
        content: "Summarize this",
        contextPaths: ["Docs/one.md", "Docs/two.pdf"],
        createdAt: expect.any(String),
      },
    ]);
  });

  it("formats indexing status for the chat pane toolbar", () => {
    expect(
      formatIndexingStatus({
        status: "idle",
        scannedFiles: 12,
        totalFiles: 12,
        progress: 1,
        indexedFiles: 3,
        skippedFiles: 9,
        embeddedChunks: 42,
        deferredFiles: 0,
        failedFiles: 0,
        lastIndexedAt: "2026-05-16T00:00:00.000Z",
        isStale: false,
      }),
    ).toBe("Idle · 3 indexed · 42 chunks · last run May 16, 2026");
    expect(
      formatIndexingStatus({
        status: "paused",
        scannedFiles: 0,
        totalFiles: 0,
        progress: 0,
        indexedFiles: 0,
        skippedFiles: 0,
        embeddedChunks: 0,
        deferredFiles: 0,
        failedFiles: 0,
        isStale: false,
      }),
    ).toBe("Paused · no completed index run");
  });

  it("formats progress values", () => {
    expect(formatProgressPercent(0.425)).toBe("43%");
  });

  it("maps citations to clickable Obsidian or web targets", () => {
    expect(citationTarget(citation(markdownSource("Research/local.md", "block-1")))).toEqual({
      kind: "obsidian",
      target: "Research/local.md#^block-1",
    });
    expect(citationTarget(citation(pdfSource("Papers/model.pdf", 3)))).toEqual({
      kind: "obsidian",
      target: "Papers/model.pdf#page=3",
    });
    expect(citationTarget(citation(webSource("https://example.com/local")))).toEqual({
      kind: "web",
      target: "https://example.com/local",
    });
  });

  it("limits the source list to evidence the finalized answer actually cites", () => {
    const cited = { id: "a", source: markdownSource("A.md"), text: "", contentHash: "a", score: 1 };
    const uncited = {
      id: "b",
      source: markdownSource("B.md"),
      text: "",
      contentHash: "b",
      score: 1,
    };
    const streaming = {
      role: "assistant" as const,
      content: "",
      createdAt: "t",
      evidence: [cited, uncited],
    };

    expect(citationEvidence(streaming as never).map((chunk) => chunk.id)).toEqual(["a", "b"]);

    const finalized = {
      ...streaming,
      answer: { citations: [{ id: "a", label: "A", source: markdownSource("A.md") }] },
    };

    expect(citationEvidence(finalized as never).map((chunk) => chunk.id)).toEqual(["a"]);
  });

  it("appends streamed answer deltas without creating a second assistant message", () => {
    const first = nextAssistantMessage([], "First ");
    const second = nextAssistantMessage(first, "second.");

    expect(second).toEqual([
      {
        role: "assistant",
        content: "First second.",
        createdAt: expect.any(String),
        evidence: undefined,
      },
    ]);
  });

  it("creates an empty streaming assistant message before the first model event", () => {
    const messages = startAssistantProgress(nextUserMessage([], "Find a recipe"), "thinking");

    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({
      role: "assistant",
      content: "",
      researchProgress: {
        phase: "streaming",
        mode: "thinking",
        reasoning: { phase: "streaming", segments: [] },
        chain: [],
      },
    });
  });

  it("records the research mode the run started in on the progress", () => {
    const instant = startAssistantProgress([], "instant");
    const deep = startAssistantProgress([], "deep-research");

    expect(instant.at(-1)?.researchProgress?.mode).toBe("instant");
    expect(deep.at(-1)?.researchProgress?.mode).toBe("deep-research");
  });

  it("keeps the recorded mode while reasoning and tool events accumulate", () => {
    const reasoned = nextAssistantReasoning(
      startAssistantProgress([], "thinking"),
      "segment-1",
      "Planning",
    );
    const withTool = nextChainToolCallStart(reasoned, "search-1", "search_web", "Search the web");

    expect(withTool.at(-1)?.researchProgress?.mode).toBe("thinking");
  });

  it("streams a classified final answer into the transcript body", () => {
    const streaming = nextAssistantCheckpoint(
      startAssistantProgress([], "thinking"),
      "round-1",
      1,
      "Answer",
    );
    const finalizing = promoteAssistantCheckpoint(streaming, "round-1");

    expect(finalizing.at(-1)).toMatchObject({
      content: "Answer",
      researchProgress: {
        phase: "streaming",
        checkpoints: [{ id: "round-1", status: "finalizing", content: "Answer" }],
      },
    });
  });

  it("demotes a completed intermediate round from the body into a workflow node", () => {
    const streaming = nextAssistantCheckpoint(
      startAssistantProgress([], "thinking"),
      "round-1",
      1,
      "Narration",
    );
    const demoted = completeAssistantCheckpoint(streaming, "round-1");

    expect(demoted.at(-1)?.content).toBe("");
    expect(demoted.at(-1)?.researchProgress?.chain).toEqual([
      { kind: "checkpoint", id: "round-1", round: 1, content: "Narration", status: "complete" },
    ]);
    expect(demoted.at(-1)?.researchProgress?.checkpoints).toEqual([
      { id: "round-1", round: 1, content: "Narration", status: "complete" },
    ]);
  });

  it("keeps the final round in the body after an intermediate round was demoted", () => {
    const first = completeAssistantCheckpoint(
      nextAssistantCheckpoint(startAssistantProgress([], "thinking"), "round-1", 1, "Narration"),
      "round-1",
    );
    const second = promoteAssistantCheckpoint(
      nextAssistantCheckpoint(first, "round-2", 2, "Answer"),
      "round-2",
    );

    expect(second.at(-1)?.content).toBe("Answer");
  });

  it("leaves the body untouched when the demoted text is no longer in it", () => {
    const streaming = nextAssistantCheckpoint(
      startAssistantProgress([], "thinking"),
      "round-1",
      1,
      "Narration",
    );
    const rewritten = [
      ...streaming.slice(0, -1),
      { ...streaming.at(-1)!, content: "Rewritten body" },
    ];
    const demoted = completeAssistantCheckpoint(rewritten, "round-1");

    expect(demoted.at(-1)?.content).toBe("Rewritten body");
    expect(demoted.at(-1)?.researchProgress?.chain).toEqual([]);
  });

  it("keeps a streamed provisional body exactly once when the run is interrupted", () => {
    const streaming = nextAssistantCheckpoint(
      startAssistantProgress([], "thinking"),
      "round-1",
      1,
      "Answer so far",
    );
    const interrupted = interruptLastAssistantProgress(streaming);

    expect(interrupted.at(-1)?.content).toBe("Answer so far");
  });

  it("preserves a classified final answer when the request is cancelled", () => {
    const streaming = nextAssistantCheckpoint(
      startAssistantProgress([], "thinking"),
      "round-1",
      1,
      "Answer",
    );
    const interrupted = interruptLastAssistantProgress(
      promoteAssistantCheckpoint(streaming, "round-1"),
    );

    expect(interrupted.at(-1)).toMatchObject({
      content: "Answer",
      researchProgress: {
        phase: "interrupted",
        checkpoints: [{ id: "round-1", status: "interrupted", content: "Answer" }],
      },
    });
  });

  it("keeps resolved fetch targets with the pending tool call", () => {
    const messages = nextChainToolCallStart(
      startAssistantProgress([], "thinking"),
      "fetch-1",
      "fetch_web_page",
      "Fetching 2 pages",
      { resultIds: ["first", "second"] },
      undefined,
      ["recipes.example.com", "food.example.org"],
    );

    expect(messages.at(-1)?.researchProgress?.chain).toContainEqual(
      expect.objectContaining({
        id: "fetch-1",
        fetchTargets: ["recipes.example.com", "food.example.org"],
      }),
    );
  });

  it("groups streamed reasoning deltas into ordered assistant segments", () => {
    const first = nextAssistantReasoning([], "round-1", "Checking ");
    const second = nextAssistantReasoning(first, "round-1", "constraints.");
    const third = nextAssistantReasoning(second, "round-2", "Verifying result.");

    expect(third).toEqual([
      {
        role: "assistant",
        content: "",
        createdAt: expect.any(String),
        researchProgress: expect.objectContaining({
          phase: "streaming",
          disclosure: "auto",
          reasoning: expect.objectContaining({
            segments: [
              { id: "round-1", kind: "summary", content: "Checking constraints." },
              { id: "round-2", kind: "summary", content: "Verifying result." },
            ],
          }),
          checkpoints: [],
        }),
      },
    ]);
  });

  it("attaches completed diagnostics to the corresponding last assistant message", () => {
    const diagnostics = { contextMode: "include" } as ContextDiagnostics;
    const answer = {
      question: "What changed?",
      answer: "Second",
      citations: [],
      followUpQuestions: [],
      createdAt: "2026-05-16T10:02:00.000Z",
      contextDiagnostics: diagnostics,
    };
    const messages = [
      { role: "assistant" as const, content: "First", createdAt: "2026-05-16T10:00:00.000Z" },
      { role: "user" as const, content: "Next", createdAt: "2026-05-16T10:01:00.000Z" },
      { role: "assistant" as const, content: "Second", createdAt: "2026-05-16T10:02:00.000Z" },
    ];

    expect(
      attachAnswerDetailsToLastAssistantMessage(messages, {
        finalAnswer: answer,
      }),
    ).toEqual([
      messages[0],
      messages[1],
      { ...messages[2], answer, evidence: [], contextDiagnostics: diagnostics },
    ]);
  });

  it("shows answer note actions only for assistant messages with a final answer", () => {
    const answer = {
      question: "What changed?",
      answer: "Final answer",
      citations: [],
      followUpQuestions: [],
      createdAt: "2026-05-16T10:02:00.000Z",
    };

    expect(
      shouldShowAnswerNoteActions({
        role: "assistant",
        content: "Final answer",
        createdAt: "2026-05-16T10:02:00.000Z",
        answer,
      }),
    ).toBe(true);
    expect(
      shouldShowAnswerNoteActions({
        role: "assistant",
        content: "Streaming answer",
        createdAt: "2026-05-16T10:02:00.000Z",
      }),
    ).toBe(false);
    expect(
      shouldShowAnswerNoteActions({
        role: "user",
        content: "Question",
        createdAt: "2026-05-16T10:01:00.000Z",
      }),
    ).toBe(false);
  });

  it("shows the diagnostic action only for debug assistant messages with a report", () => {
    const assistantMessage = {
      role: "assistant" as const,
      content: "Answer",
      createdAt: "2026-05-16T10:00:00.000Z",
      contextDiagnostics: { contextMode: "include" } as ContextDiagnostics,
    };

    expect(shouldShowDiagnosticAction(assistantMessage, true)).toBe(true);
    expect(shouldShowDiagnosticAction(assistantMessage, false)).toBe(false);
    expect(
      shouldShowDiagnosticAction({ ...assistantMessage, contextDiagnostics: undefined }, true),
    ).toBe(false);
    expect(shouldShowDiagnosticAction({ ...assistantMessage, role: "user" }, true)).toBe(false);
  });

  it("removes per-message diagnostics before non-debug chat persistence", () => {
    const diagnostics = { contextMode: "include" } as ContextDiagnostics;
    const messages = [
      {
        role: "assistant" as const,
        content: "Answer",
        createdAt: "2026-05-16T10:00:00.000Z",
        contextDiagnostics: diagnostics,
      },
      { role: "user" as const, content: "Next", createdAt: "2026-05-16T10:01:00.000Z" },
    ];

    expect(stripMessageDiagnostics(messages)).toEqual([
      { role: "assistant", content: "Answer", createdAt: "2026-05-16T10:00:00.000Z" },
      messages[1],
    ]);
  });

  it("removes citation ids and follow-up sections from displayed assistant content", () => {
    expect(
      messageDisplayContent({
        role: "assistant",
        content:
          "The answer cites local notes [1faca705800f51b4679ba10c0ec7923f].\n\n## Citations\n1. Source\n\nFollow-up questions:\n1. Next?",
        createdAt: "2026-05-16T00:00:00.000Z",
      }),
    ).toBe("The answer cites local notes.");
  });

  it("keeps citation ids in markdown content so the chat can replace them with anchors", () => {
    expect(
      messageMarkdownContent({
        role: "assistant",
        content: "The answer cites local notes [1faca705800f51b4679ba10c0ec7923f].",
        createdAt: "2026-05-16T00:00:00.000Z",
      }),
    ).toBe("The answer cites local notes [1faca705800f51b4679ba10c0ec7923f].");
  });

  it("resolves the displayed assistant label from the selected chat model profile id", () => {
    expect(
      selectedChatModelProfileLabel(
        [
          { id: "default", name: "Default model" },
          { id: "selected", name: "Selected model" },
        ],
        "selected",
      ),
    ).toBe("Selected model");
  });

  it("enables saved-chat list scrolling only after fifteen visible rows", () => {
    expect(shouldScrollSavedChatsList(15)).toBe(false);
    expect(shouldScrollSavedChatsList(16)).toBe(true);
  });

  it("shows only favorites on the Favorites tab while retaining them in History", () => {
    const chats = [
      {
        id: "favorite",
        title: "Favorite",
        updatedAt: "2026-06-10T10:00:00Z",
        messageCount: 1,
        isFavorite: true,
      },
      {
        id: "history",
        title: "History",
        updatedAt: "2026-06-10T09:00:00Z",
        messageCount: 1,
        isFavorite: false,
      },
    ];

    expect(filterSavedChatsByTab(chats, "history").map((chat) => chat.id)).toEqual([
      "favorite",
      "history",
    ]);
    expect(filterSavedChatsByTab(chats, "favorites").map((chat) => chat.id)).toEqual(["favorite"]);
  });
});

function citation(source: SourceReference): Citation {
  return { id: source.id, source, label: source.title };
}

function markdownSource(path: string, blockId?: string): SourceReference {
  return {
    id: `source-${path}`,
    kind: "markdown",
    title: path,
    path,
    headingPath: [],
    ...(blockId ? { blockId } : {}),
  };
}

function pdfSource(path: string, pageNumber: number): SourceReference {
  return {
    id: `source-${path}`,
    kind: "pdf",
    title: path,
    path,
    pageNumber,
  };
}

function webSource(url: string): SourceReference {
  return {
    id: `source-${url}`,
    kind: "web",
    title: "Example",
    url,
    snippet: "Snippet",
    retrievedAt: "2026-05-16T00:00:00.000Z",
    wasContentFetched: true,
  };
}
