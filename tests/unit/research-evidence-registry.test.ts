import { ResearchEvidenceRegistry } from "@adapters/research-tools/ResearchEvidenceRegistry";
import { markdownSource, retrieved } from "../support/factories";

describe("ResearchEvidenceRegistry", () => {
  it("deduplicates index chunks and combines provenance", () => {
    const registry = new ResearchEvidenceRegistry();
    const chunk = retrieved("chunk-1", markdownSource("Notes/One.md"), "Evidence");

    registry.registerIndexChunk(chunk, { callId: "call-1", query: "first" });
    registry.registerIndexChunk(chunk, { callId: "call-2", query: "second" });

    const snapshot = registry.snapshot();
    expect(snapshot.evidence).toHaveLength(1);
    expect(snapshot.citations).toHaveLength(1);
    expect(snapshot.provenance).toEqual([
      {
        evidenceId: "chunk-1",
        calls: [
          { callId: "call-1", query: "first", tool: "search_index" },
          { callId: "call-2", query: "second", tool: "search_index" },
        ],
      },
    ]);
  });

  it("canonicalizes duplicate web URLs and upgrades snippet evidence to page content", () => {
    const registry = new ResearchEvidenceRegistry({
      createHandle: () => "result-answer-a",
      now: () => new Date("2026-06-20T00:00:00.000Z"),
    });
    const first = registry.registerWebResult(
      {
        url: "HTTPS://Example.COM:443/path?q=1#section",
        title: "Example",
        snippet: "Search snippet",
        rank: 1,
      },
      { callId: "call-1", query: "first" },
    );
    const duplicate = registry.registerWebResult(
      {
        url: "https://example.com/path?q=1#other",
        title: "Duplicate",
        snippet: "Other snippet",
        rank: 2,
      },
      { callId: "call-2", query: "second" },
    );

    expect(duplicate).toEqual(first);
    registry.upgradeWebPage(first.resultId, {
      content: "Fetched page content",
      finalUrl: "https://www.example.com/final",
      truncated: false,
      callId: "call-3",
    });

    const snapshot = registry.snapshot();
    expect(snapshot.evidence).toHaveLength(1);
    expect(snapshot.evidence[0]).toMatchObject({
      id: first.evidenceId,
      text: "Fetched page content",
      source: {
        url: "https://example.com/path?q=1",
        wasContentFetched: true,
      },
    });
    expect(snapshot.provenance[0]?.calls).toHaveLength(3);
    expect(snapshot.provenance[0]?.page).toEqual({
      finalUrl: "https://www.example.com/final",
      truncated: false,
    });
  });

  it("keeps handles isolated and returns a detached frozen snapshot", () => {
    const first = new ResearchEvidenceRegistry({ createHandle: () => "first-handle" });
    const second = new ResearchEvidenceRegistry({ createHandle: () => "second-handle" });
    const registered = first.registerWebResult(
      { url: "https://example.com", title: "Example", snippet: "Snippet", rank: 1 },
      { callId: "call-1", query: "query" },
    );

    expect(first.resolveWebResult(registered.resultId)).toBeDefined();
    expect(second.resolveWebResult(registered.resultId)).toBeUndefined();

    const snapshot = first.snapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.evidence)).toBe(true);
    expect(() => (snapshot.evidence as unknown[]).push({})).toThrow();
  });

  it("builds the evidence of a page from its head and the passages returned, and cuts a new passage to the room left instead of dropping an earlier one", () => {
    const registry = new ResearchEvidenceRegistry({ createHandle: () => "handle" });
    const { resultId } = registry.registerWebResult(
      { url: "https://example.com/long", title: "Long", snippet: "s", rank: 1 },
      { callId: "search", query: "q" },
    );
    registry.upgradeWebPage(resultId, {
      content: "HEAD",
      finalUrl: "https://example.com/long",
      truncated: false,
      callId: "fetch",
    });

    registry.addWebPassages(resultId, [{ offset: 5000, text: "later passage" }], "find-1");
    registry.addWebPassages(resultId, [{ offset: 100, text: "early passage" }], "find-2");
    registry.addWebPassages(resultId, [{ offset: 106, text: "passage extended" }], "find-3");
    const ordered = registry.snapshot().evidence[0]!.text;
    const accepted = registry.addWebPassages(
      resultId,
      [{ offset: 9000, text: "x".repeat(16_000) }],
      "find-4",
    );
    const capped = registry.snapshot().evidence[0]!.text;

    expect(ordered).toBe(
      "HEAD\n\n[… offset 100 …]\nearly passage extended\n\n[… offset 5000 …]\nlater passage",
    );
    expect(capped.length).toBeLessThanOrEqual(16_000);
    expect(capped).toContain("[… offset 9000 …]");
    expect(capped).toContain("later passage");
    expect(capped).toContain("early passage extended");
    expect(accepted[0]!.text.length).toBeLessThan(16_000);
    expect(accepted[0]!.text.length).toBeGreaterThan(0);
  });

  it("cuts a passage to the room left at a text boundary, never inside a surrogate pair", () => {
    const registry = new ResearchEvidenceRegistry({ createHandle: () => "handle" });
    const { resultId } = registry.registerWebResult(
      { url: "https://example.com/long", title: "Long", snippet: "s", rank: 1 },
      { callId: "search", query: "q" },
    );
    registry.upgradeWebPage(resultId, {
      content: "HEAD",
      finalUrl: "https://example.com/long",
      truncated: false,
      callId: "fetch",
    });

    registry.addWebPassages(resultId, [{ offset: 100, text: "a".repeat(15_001) }], "read-1");
    const [second] = registry.addWebPassages(
      resultId,
      [{ offset: 50_000, text: "😀".repeat(2_000) }],
      "read-2",
    );

    expect(second!.text.length).toBeGreaterThan(200);
    expect(second!.text).toMatch(/^(?:😀)+$/u);
  });

  it("joins a passage that continues the head without a marker so a quote across them stays whole", () => {
    const registry = new ResearchEvidenceRegistry({ createHandle: () => "handle" });
    const { resultId } = registry.registerWebResult(
      { url: "https://example.com/long", title: "Long", snippet: "s", rank: 1 },
      { callId: "search", query: "q" },
    );
    const head = `${"a ".repeat(995)}the quote starts`;
    registry.upgradeWebPage(resultId, {
      content: head,
      finalUrl: "https://example.com/long",
      truncated: false,
      callId: "fetch",
    });

    registry.addWebPassages(
      resultId,
      [{ offset: head.length - 16, text: "the quote starts and ends here. Later text." }],
      "read-1",
    );
    registry.addWebPassages(resultId, [{ offset: 9_000, text: "far passage" }], "read-2");

    const text = registry.snapshot().evidence[0]!.text;
    expect(text).toContain("the quote starts and ends here.");
    expect(text).toContain("[… offset 9000 …]\nfar passage");
  });
});
