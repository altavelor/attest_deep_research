import { describeToolCall } from "@apps/obsidian/ui/chat/toolCallView";

describe("describeToolCall inline arguments", () => {
  it("renders call arguments on a single line", () => {
    const view = describeToolCall({
      name: "search_index",
      label: "search_index",
      status: "complete",
      args: { query: "riquet", limit: 5, prefix: "Notes" },
    });

    expect(view.inCell?.kind).toBe("code");
    const text = view.inCell?.kind === "code" ? view.inCell.text : "";
    expect(text).not.toContain("\n");
    expect(text).toContain('"query":"riquet"');
  });
});

describe("describeToolCall detailed intent", () => {
  it("includes search scope (prefix and limit) in the vault search intent", () => {
    const view = describeToolCall({
      name: "search_index",
      label: "search_index",
      status: "complete",
      args: { query: "riquet", limit: 5, prefix: "Notes" },
    });

    expect(view.intent).toBe("Searching the vault for “riquet” (under “Notes”, top 5)");
  });

  it("names the host for a web fetch", () => {
    const view = describeToolCall({
      name: "fetch_web_page",
      label: "fetch_web_page",
      status: "complete",
      args: { url: "https://example.com/a/b?c=1" },
    });

    expect(view.intent).toBe("Fetching the page at example.com");
  });

  it("reports created-note size in the intent", () => {
    const view = describeToolCall({
      name: "create_note",
      label: "create_note",
      status: "complete",
      args: { path: "Ideas/New.md", content: "hello" },
    });

    expect(view.intent).toBe("Creating the note “New” (5 chars)");
  });
});
