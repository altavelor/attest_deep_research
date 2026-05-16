import { citationTarget, formatIndexingStatus, nextAssistantMessage } from "../../src/ui/rendering";
import { Citation, SourceReference } from "../../src/shared/types";

describe("chat rendering helpers", () => {
  it("formats indexing status for the chat pane toolbar", () => {
    expect(
      formatIndexingStatus({
        status: "idle",
        scannedFiles: 12,
        indexedFiles: 3,
        skippedFiles: 9,
        embeddedChunks: 42,
        lastIndexedAt: "2026-05-16T00:00:00.000Z",
      }),
    ).toBe("Idle · 3 indexed · 42 chunks · last run May 16, 2026");
    expect(
      formatIndexingStatus({
        status: "paused",
        scannedFiles: 0,
        indexedFiles: 0,
        skippedFiles: 0,
        embeddedChunks: 0,
      }),
    ).toBe("Paused · no completed index run");
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
      },
    ]);
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
