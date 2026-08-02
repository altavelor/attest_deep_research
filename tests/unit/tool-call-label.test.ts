import { describe, it, expect } from "vitest";
import {
  toolCallChainLabel,
  resolveLabelFromResult,
  resolveResultSummary,
} from "@application/research";

describe("toolCallChainLabel", () => {
  it("returns query for search tools", () => {
    expect(toolCallChainLabel("search_index", { query: "zettelkasten inbox" })).toBe(
      "zettelkasten inbox",
    );
    expect(toolCallChainLabel("search_notes", { query: "fleeting notes" })).toBe("fleeting notes");
    expect(toolCallChainLabel("search_web", { query: "obsidian plugins" })).toBe(
      "obsidian plugins",
    );
  });

  it("truncates long queries to 60 chars with ellipsis", () => {
    const long = "a".repeat(70);
    const result = toolCallChainLabel("search_index", { query: long });
    expect(result).toBe("a".repeat(60) + "…");
  });

  it("falls back to a readable tool name when query is empty or not a string", () => {
    expect(toolCallChainLabel("search_index", { query: "" })).toBe("Search index");
    expect(toolCallChainLabel("search_index", { query: 42 })).toBe("Search index");
    expect(toolCallChainLabel("search_index", {})).toBe("Search index");
  });

  it("returns Fetching page(s) for fetch_web_page by resultIds count", () => {
    expect(toolCallChainLabel("fetch_web_page", { resultIds: ["abc123"] })).toBe("Fetching page");
    expect(toolCallChainLabel("fetch_web_page", { resultIds: ["a", "b", "c"] })).toBe(
      "Fetching 3 pages",
    );
  });

  it("returns basename without .md for read_note and mutation tools", () => {
    expect(toolCallChainLabel("read_note", { path: "Notes/Inbox process.md" })).toBe(
      "Inbox process",
    );
    expect(toolCallChainLabel("create_note", { path: "journal/2026-01-01.md" })).toBe("2026-01-01");
    expect(toolCallChainLabel("update_note", { path: "toplevel.md" })).toBe("toplevel");
    expect(toolCallChainLabel("delete_note", { path: "trash/old.md" })).toBe("old");
  });

  it("handles path without .md extension", () => {
    expect(toolCallChainLabel("read_note", { path: "somefile.txt" })).toBe("somefile.txt");
  });

  it("returns Active note for get_active_note", () => {
    expect(toolCallChainLabel("get_active_note", {})).toBe("Active note");
  });

  it("returns prefix or All notes for list_notes", () => {
    expect(toolCallChainLabel("list_notes", { prefix: "Projects/" })).toBe("Projects/");
    expect(toolCallChainLabel("list_notes", {})).toBe("All notes");
    expect(toolCallChainLabel("list_notes", { prefix: "" })).toBe("All notes");
  });

  it("humanizes the name of an unknown tool instead of showing raw snake_case", () => {
    expect(toolCallChainLabel("some_unknown_tool", {})).toBe("Some unknown tool");
  });
});

describe("resolveLabelFromResult", () => {
  it("extracts hostname from a single-page fetch_web_page result", () => {
    const result = JSON.stringify({
      ok: true,
      value: {
        pages: [
          {
            ok: true,
            url: "https://example.com/path",
            finalUrl: "https://example.com/path",
            content: "",
          },
        ],
      },
    });
    expect(resolveLabelFromResult("fetch_web_page", result)).toBe("example.com");
  });

  it("prefers finalUrl over url", () => {
    const result = JSON.stringify({
      ok: true,
      value: {
        pages: [
          {
            ok: true,
            url: "https://original.com/",
            finalUrl: "https://redirected.com/page",
            content: "",
          },
        ],
      },
    });
    expect(resolveLabelFromResult("fetch_web_page", result)).toBe("redirected.com");
  });

  it("summarizes distinct hosts for a batch fetch_web_page result", () => {
    const result = JSON.stringify({
      ok: true,
      value: {
        pages: [
          { ok: true, finalUrl: "https://a.example/x", content: "" },
          { ok: true, finalUrl: "https://b.example/y", content: "" },
        ],
      },
    });
    expect(resolveLabelFromResult("fetch_web_page", result)).toBe("2 hosts");
  });

  it("returns undefined for non-fetch_web_page tools", () => {
    const result = JSON.stringify({ ok: true, value: { results: [] } });
    expect(resolveLabelFromResult("search_index", result)).toBeUndefined();
    expect(resolveLabelFromResult("read_note", result)).toBeUndefined();
  });

  it("returns undefined on malformed JSON", () => {
    expect(resolveLabelFromResult("fetch_web_page", "not-json")).toBeUndefined();
  });

  it("returns undefined when no page succeeded", () => {
    const result = JSON.stringify({
      ok: true,
      value: { pages: [{ ok: false, resultId: "r1", error: {} }] },
    });
    expect(resolveLabelFromResult("fetch_web_page", result)).toBeUndefined();
  });
});

describe("resolveResultSummary", () => {
  it("returns N results for search tools", () => {
    const result = JSON.stringify({ ok: true, value: { results: [{}, {}, {}] } });
    expect(resolveResultSummary("search_index", result)).toBe("3 results");
    expect(resolveResultSummary("search_web", result)).toBe("3 results");
    expect(resolveResultSummary("search_notes", result)).toBe("3 results");
  });

  it("returns no results when array is empty", () => {
    const result = JSON.stringify({ ok: true, value: { results: [] } });
    expect(resolveResultSummary("search_index", result)).toBe("no results");
  });

  it("returns total kb size across fetch_web_page pages", () => {
    const result = JSON.stringify({
      ok: true,
      value: {
        pages: [
          { ok: true, content: "x".repeat(1024), finalUrl: "https://a.example" },
          { ok: true, content: "x".repeat(1024), finalUrl: "https://b.example" },
        ],
      },
    });
    expect(resolveResultSummary("fetch_web_page", result)).toBe("~2.0 kb");
  });

  it("appends failed count for partially failed fetch_web_page batches", () => {
    const result = JSON.stringify({
      ok: true,
      value: {
        pages: [
          { ok: true, content: "x".repeat(2048), finalUrl: "https://a.example" },
          { ok: false, resultId: "r2", error: {} },
        ],
      },
    });
    expect(resolveResultSummary("fetch_web_page", result)).toBe("~2.0 kb (1 failed)");
  });

  it("returns kb size for read_note from chunk text", () => {
    const text = "x".repeat(1024);
    const result = JSON.stringify({
      ok: true,
      value: { chunks: [{ text, id: "c1", evidenceSource: {} }] },
    });
    expect(resolveResultSummary("read_note", result)).toBe("~1.0 kb");
  });

  it("returns done for mutation tools on success", () => {
    const result = JSON.stringify({ ok: true });
    expect(resolveResultSummary("create_note", result)).toBe("done");
    expect(resolveResultSummary("update_note", result)).toBe("done");
    expect(resolveResultSummary("delete_note", result)).toBe("done");
  });

  it("returns undefined for mutation tools on failure", () => {
    const result = JSON.stringify({ ok: false, error: { code: "already-exists" } });
    expect(resolveResultSummary("create_note", result)).toBeUndefined();
  });

  it("returns undefined for unknown tools", () => {
    const result = JSON.stringify({ ok: true });
    expect(resolveResultSummary("some_tool", result)).toBeUndefined();
  });

  it("returns undefined on malformed JSON", () => {
    expect(resolveResultSummary("search_index", "bad")).toBeUndefined();
  });
});
