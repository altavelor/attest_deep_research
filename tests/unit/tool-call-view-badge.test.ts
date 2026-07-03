import { describeToolCall } from "@apps/obsidian/ui/chat/toolCallView";

describe("describeToolCall search_index badge", () => {
  it("shows a keyword-only badge when semantic search degraded", () => {
    const view = describeToolCall({
      name: "search_index",
      label: "search_index",
      status: "complete",
      args: { query: "riquet" },
      resultJson: JSON.stringify({
        ok: true,
        results: [],
        diagnostics: {
          resultCount: 0,
          snippetsTruncated: 0,
          untrustedEvidence: true,
          usedKeywordFallback: true,
          semanticError: "embedding unavailable",
        },
      }),
    });

    expect(view.badge).toEqual({
      text: "keyword-only",
      tooltip: "Semantic (embedding) search failed: embedding unavailable",
    });
  });

  it("omits the badge when retrieval is healthy", () => {
    const view = describeToolCall({
      name: "search_index",
      label: "search_index",
      status: "complete",
      args: { query: "riquet" },
      resultJson: JSON.stringify({
        ok: true,
        results: [],
        diagnostics: { resultCount: 0, snippetsTruncated: 0, untrustedEvidence: true },
      }),
    });

    expect(view.badge).toBeUndefined();
  });
});
