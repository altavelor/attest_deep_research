import { createTranslator } from "@adapters/i18n";
import { describeToolCall } from "@apps/obsidian/ui/chat/toolCallView";

const t = createTranslator("en").t;

describe("describeToolCall inline arguments", () => {
  it("renders call arguments on a single line", () => {
    const view = describeToolCall({
      t,
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
      t,
      name: "search_index",
      label: "search_index",
      status: "complete",
      args: { query: "riquet", limit: 5, prefix: "Notes" },
    });

    expect(view.intent).toBe("Searching the vault for “riquet” (under “Notes”, top 5)");
  });

  it("hides fetched page hosts after the web fetch completes", () => {
    const view = describeToolCall({
      t,
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

    expect(view.intent).toBe("Fetching pages 3");
    expect(view.fetchTargets).toEqual([]);
  });

  it("lists requested page hosts while a web fetch is pending", () => {
    const view = describeToolCall({
      t,
      name: "fetch_web_page",
      label: "Fetching 3 pages",
      status: "pending",
      args: { resultIds: ["a", "b", "c"] },
      fetchTargets: ["recipes.example.com", "food.example.org", "recipes.example.com"],
    });

    expect(view.intent).toBe("Fetching pages 3:");
    expect(view.fetchTargets).toEqual(["recipes.example.com", "food.example.org"]);
  });

  it("names the search provider used for a web query", () => {
    const view = describeToolCall({
      t,
      name: "search_web",
      label: "search_web",
      status: "pending",
      args: { query: "classic syrniki recipe" },
      searchSources: ["DuckDuckGo", "Brave"],
    });

    expect(view.intent).toBe("Searching DuckDuckGo, Brave for “classic syrniki recipe”");
  });

  it("reports created-note size in the intent", () => {
    const view = describeToolCall({
      t,
      name: "create_note",
      label: "create_note",
      status: "complete",
      args: { path: "Ideas/New.md", content: "hello" },
    });

    expect(view.intent).toBe("Creating the note “New” (5 chars)");
  });

  it("shows failed calls with their arguments and a compact error payload", () => {
    const view = describeToolCall({
      t,
      name: "search_web",
      label: "Search web",
      status: "failed",
      args: { query: "latest release" },
      resultJson: '{\n  "error": "timeout"\n}',
    });

    expect(view).toMatchObject({
      intent: "Searching the web for “latest release”",
      inCell: { kind: "code", text: '{"query":"latest release"}' },
      outCell: { kind: "code", text: '{"error":"timeout"}' },
    });
  });

  it("renders a diff only when an update actually changes a note", () => {
    const changed = describeToolCall({
      t,
      name: "update_note",
      label: "Update note",
      status: "complete",
      resultJson: JSON.stringify({ before: "First\nOld", after: "First\nNew" }),
    });
    const unchanged = describeToolCall({
      t,
      name: "update_note",
      label: "Update note",
      status: "complete",
      resultJson: JSON.stringify({ before: "Same", after: "Same" }),
    });

    expect(changed.outCell).toMatchObject({ kind: "diff" });
    expect(unchanged.outCell).toBeUndefined();
  });

  it("derives pending fetch hosts from a partial result when explicit targets are unavailable", () => {
    const view = describeToolCall({
      t,
      name: "fetch_web_page",
      label: "Fetch pages",
      status: "pending",
      resultJson: JSON.stringify({
        value: {
          pages: [
            { ok: true, finalUrl: "https://docs.example.com/a" },
            { ok: true, url: "not-a-url" },
            { ok: false, url: "https://ignored.example.com" },
          ],
        },
      }),
    });

    expect(view.fetchTargets).toEqual(["docs.example.com", "not-a-url"]);
  });

  it("keeps note reads concise while previewing created text and humanizing unknown tools", () => {
    expect(
      describeToolCall({
        t,
        name: "read_note",
        label: "Read note",
        status: "complete",
        args: { path: "Notes/Plan.md" },
      }).intent,
    ).toContain("Plan");
    expect(
      describeToolCall({
        t,
        name: "create_note",
        label: "Create note",
        status: "complete",
        args: { content: "Draft" },
      }),
    ).toMatchObject({ outCell: { kind: "text", text: "Draft" } });
    expect(
      describeToolCall({
        t,
        name: "custom_tool_name",
        label: "custom_tool_name",
        status: "complete",
      }).intent,
    ).toBe("Custom tool name");
  });
});

describe("describeToolCall calculation", () => {
  const code = "({ change: (inputs.b - inputs.a) / inputs.a * 100 })";

  it("shows the inputs with the code and the result with its logs to every user", () => {
    const view = describeToolCall({
      t,
      name: "run_js",
      label: "Calculation",
      status: "complete",
      args: { code, inputs: { a: 80, b: 92 }, purpose: "revenue change" },
      resultJson: JSON.stringify({
        ok: true,
        computationId: "calc_1",
        result: { change: 15 },
        logs: ["rows"],
      }),
    });

    expect(view).toEqual({
      intent: "Calculating “revenue change”",
      fetchTargets: [],
      cellsAlwaysVisible: true,
      inCell: { kind: "code", text: `const inputs = {\n  "a": 80,\n  "b": 92\n};\n\n${code}` },
      outCell: { kind: "code", text: '{\n  "change": 15\n}\n// rows' },
    });
  });

  it("shows the failure code and message of a failed calculation", () => {
    const view = describeToolCall({
      t,
      name: "run_js",
      label: "Calculation",
      status: "failed",
      args: { code: "while (true) {}" },
      resultJson: JSON.stringify({
        ok: false,
        error: {
          code: "timeout",
          message: "The script exceeded its time limit.",
          details: { logs: ["start"] },
        },
      }),
    });

    expect(view.inCell).toEqual({ kind: "code", text: "while (true) {}" });
    expect(view.outCell).toEqual({
      kind: "code",
      text: "timeout: The script exceeded its time limit.\n// start",
    });
  });

  it("falls back to the raw arguments and result when they are malformed", () => {
    const view = describeToolCall({
      t,
      name: "run_js",
      label: "Calculation",
      status: "failed",
      args: { code: 42 },
      resultJson: '{"ok": false,  "reason": "tool-output-budget-exceeded"}',
    });

    expect(view.inCell).toEqual({ kind: "code", text: '{"code":42}' });
    expect(view.outCell).toEqual({
      kind: "code",
      text: '{"ok":false,"reason":"tool-output-budget-exceeded"}',
    });
  });
});
