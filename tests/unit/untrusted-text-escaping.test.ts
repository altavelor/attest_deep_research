import { extractReadableText, WEB_SOURCE_DEFINITIONS } from "@adapters/web";
import { linkifyUrlCitations } from "@application/use-cases/research";
import { cleanupDanglingMarkdown } from "@core/conversation";
import { chartDataTable } from "@core/media";
import { buildThinkingResearchMessages, parseMarkdownGraphLinks } from "@core/research";

describe("readable text extraction", () => {
  it("removes script blocks that use spaced or unterminated end tags", () => {
    expect(extractReadableText("<p>a</p><script>evil()</script >b", 10_000)).toBe("a b");
    expect(extractReadableText("<p>a</p><script>evil()", 10_000)).toBe("a");
  });

  it("decodes entities in a single pass without double unescaping", () => {
    expect(extractReadableText("<p>&amp;lt;img&amp;gt;</p>", 10_000)).toBe("&lt;img&gt;");
  });

  it("keeps out-of-range numeric character references verbatim", () => {
    expect(extractReadableText("<p>&#x110000;</p>", 10_000)).toBe("&#x110000;");
  });

  it("bounds pathological repeated newlines in dangling markdown cleanup", () => {
    expect(cleanupDanglingMarkdown(`text${"\n".repeat(5_000)}**`)).toBe("text");
  });
});

describe("wikipedia snippet stripping", () => {
  it("removes nested tag remnants that would reassemble into markup", () => {
    const source = WEB_SOURCE_DEFINITIONS.find(
      (definition) => definition.descriptor.id === "wikipedia",
    );
    if (!source) throw new Error("wikipedia source definition missing");

    const results = source.parseResponse(
      JSON.stringify({
        query: { search: [{ title: "T", snippet: "<scr<span>ipt>alert(1)</scr<span>ipt>" }] },
      }),
      { query: "q", limit: 1, language: "en", credentials: {} },
    );

    expect(results[0]?.snippet).not.toContain("<script");
    expect(results[0]?.snippet).not.toContain("<");
  });
});

describe("graph link parsing", () => {
  it("ignores links inside an unterminated html comment", () => {
    const parsed = parseMarkdownGraphLinks("[[Kept]]\n<!-- [[Ignored]]");

    expect(parsed.links).toEqual(["Kept"]);
  });
});

describe("prompt attribute sanitization", () => {
  it("escapes quotes in explicit evidence attributes", () => {
    const messages = buildThinkingResearchMessages({
      question: "q",
      requiredTools: [],
      toolContext: { coreVariant: "research", availableTools: [] },
      explicitEvidence: [
        {
          id: "c\" injected='1",
          text: "content",
          score: 1,
          contentHash: "h",
          source: { id: "s", kind: "markdown", path: "A.md", title: "A", headingPath: [] },
        },
      ],
    });
    const system = messages.find((message) => message.role === "system")?.content ?? "";

    expect(system).toContain('id="c&quot; injected=&#39;1"');
    expect(system).not.toContain('injected="1"');
  });
});

describe("markdown escaping of untrusted labels", () => {
  it("escapes trailing backslashes before pipes in chart tables", () => {
    const table = chartDataTable({
      type: "chart",
      id: "chart-1",
      chartType: "bar",
      title: "t",
      series: [{ name: "s", points: [{ x: "a\\", y: 1 }] }],
    });

    expect(table).toContain("| a\\\\ |");
  });

  it("escapes backslashes in url citation labels", () => {
    const linked = linkifyUrlCitations("[url:https://example.com/a]", { label: () => "x\\" });

    expect(linked).toBe("[x\\\\](https://example.com/a)");
  });
});
