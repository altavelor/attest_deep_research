import { ResearchEvidenceRegistry } from "../../src/adapters/research-tools/ResearchEvidenceRegistry";
import { markdownSource, retrieved } from "../helpers/factories";

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
});
