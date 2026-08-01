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

  it("lists fetched page hosts in the web fetch intent", () => {
    const view = describeToolCall({
      name: "fetch_web_page",
      label: "fetch_web_page",
      status: "complete",
      args: { resultIds: ["a", "b", "c"] },
      resultJson: JSON.stringify({
        ok: true,
        value: {
          pages: [
            { ok: true, finalUrl: "https://recipes.example.com/a", content: "" },
            { ok: true, finalUrl: "https://food.example.org/b", content: "" },
            { ok: true, finalUrl: "https://recipes.example.com/c", content: "" },
          ],
        },
      }),
    });

    expect(view.intent).toBe("Fetching pages 3: recipes.example.com, food.example.org");
  });

  it("lists requested page hosts while a web fetch is pending", () => {
    const view = describeToolCall({
      name: "fetch_web_page",
      label: "Fetching 3 pages",
      status: "pending",
      args: { resultIds: ["a", "b", "c"] },
      fetchTargets: ["recipes.example.com", "food.example.org", "recipes.example.com"],
    });

    expect(view.intent).toBe("Fetching pages 3: recipes.example.com, food.example.org");
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
