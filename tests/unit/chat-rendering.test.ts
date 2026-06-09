import {
  citationTarget,
  formatIndexControlSummary,
  formatIndexingStatus,
  formatProgressPercent,
  messageDisplayContent,
  messageMarkdownContent,
  nextAssistantMessage,
} from "../../src/ui/rendering";
import { Citation, SourceReference } from "../../src/shared/types";

describe("chat rendering helpers", () => {
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

  it("formats index control summary and progress values", () => {
    expect(
      formatIndexControlSummary({
        status: "stale",
        scannedFiles: 12,
        totalFiles: 12,
        progress: 1,
        indexedFiles: 3,
        skippedFiles: 9,
        embeddedChunks: 42,
        deferredFiles: 0,
        failedFiles: 0,
        indexSizeBytes: 42 * 1024,
        lastIndexedAt: "2026-05-16T00:00:00.000Z",
        isStale: true,
      }),
    ).toBe("Rebuild needed · 3 files · 42 KB · May 16, 2026");
    expect(
      formatIndexControlSummary({
        status: "error",
        scannedFiles: 1,
        totalFiles: 2,
        progress: 0.5,
        indexedFiles: 0,
        skippedFiles: 0,
        embeddedChunks: 0,
        deferredFiles: 0,
        failedFiles: 0,
        isStale: false,
        errorMessage: "Embedding provider unavailable",
      }),
    ).toBe("Indexing failed · Embedding provider unavailable");
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
