import { createTranslator } from "@adapters/i18n";
import { describeToolCall } from "@apps/obsidian/ui/chat/toolCallView";

const t = createTranslator("en").t;

describe("describeToolCall search_index badge", () => {
  it("shows a keyword-only badge when semantic search degraded", () => {
    const view = describeToolCall({
      t,
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
      t,
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

  it("ignores a failed result whose key is foreign or whose code is not tool-unavailable", () => {
    const failed = (code: string, userMessageKey: string) =>
      describeToolCall({
        t,
        name: "run_subagent",
        label: "run_subagent",
        status: "failed",
        resultJson: JSON.stringify({
          ok: false,
          error: { code, details: { userMessageKey, params: { tool: "run_subagent" } } },
        }),
      }).badge;

    expect(failed("tool-unavailable", "settings.title")).toBeUndefined();
    expect(failed("unknown-tool", "chat.toolUnavailable.not-offered")).toBeUndefined();
  });
});
