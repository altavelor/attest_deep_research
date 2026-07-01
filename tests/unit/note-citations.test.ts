import { applyNoteCitations, maxFootnoteNumber } from "../../src/adapters/research-tools/note/noteCitations";
import { Citation } from "@core/model";

const WEB_ID = "web:2ae04bc10163edbd0a7a2a54f16906c4b56a06af8da0df2ec44ca23e9b81abe5";

function webCitation(id: string, title: string, url: string): Citation {
  return {
    id,
    label: title,
    source: {
      id,
      kind: "web",
      title,
      url,
      snippet: "",
      retrievedAt: "2026-06-25T00:00:00.000Z",
      wasContentFetched: false,
    },
  };
}

function markdownCitation(id: string, path: string, title: string): Citation {
  return {
    id,
    label: title,
    source: { id, kind: "markdown", title, path, headingPath: [] },
  };
}

describe("applyNoteCitations", () => {
  it("rewrites a web citation token into a footnote with a clickable URL", () => {
    const citations = [webCitation(WEB_ID, "Elephants — Wikipedia", "https://en.wikipedia.org/wiki/Elephant")];
    const { content, count } = applyNoteCitations(
      `Elephants live up to 70 years [${WEB_ID}].`,
      citations,
    );

    expect(count).toBe(1);
    expect(content).toContain("Elephants live up to 70 years [^1].");
    expect(content).toContain(
      "[^1]: [Elephants — Wikipedia](https://en.wikipedia.org/wiki/Elephant)",
    );
    expect(content).not.toContain(WEB_ID);
  });

  it("reuses one footnote number for a repeated citation", () => {
    const citations = [webCitation(WEB_ID, "Source", "https://example.com")];
    const { content } = applyNoteCitations(
      `First [${WEB_ID}]. Second [${WEB_ID}].`,
      citations,
    );

    expect(content).toContain("First [^1]. Second [^1].");
    expect(content.match(/\[\^1\]:/g)).toHaveLength(1);
  });

  it("links local sources with an Obsidian wikilink", () => {
    const citations = [markdownCitation("chunk-1", "Animals/Elephant.md", "Elephant")];
    const { content } = applyNoteCitations("See the note [chunk-1].", citations);

    expect(content).toContain("See the note [^1].");
    expect(content).toContain("[^1]: [[Animals/Elephant.md|Elephant]]");
  });

  it("numbers multiple distinct citations in order of first appearance", () => {
    const citations = [
      webCitation("web:aaa", "A", "https://a.example"),
      webCitation("web:bbb", "B", "https://b.example"),
    ];
    const { content } = applyNoteCitations("[web:bbb] then [web:aaa] then [web:bbb].", citations);

    expect(content).toContain("[^1] then [^2] then [^1].");
  });

  it("leaves unknown tokens and markdown links untouched", () => {
    const citations = [webCitation(WEB_ID, "Source", "https://example.com")];
    const { content, count } = applyNoteCitations(
      "A list item [TODO] and a [link](https://example.com).",
      citations,
    );

    expect(count).toBe(0);
    expect(content).toBe("A list item [TODO] and a [link](https://example.com).");
  });

  it("returns content unchanged when there are no citations", () => {
    const { content, count } = applyNoteCitations(`Text [${WEB_ID}].`, []);
    expect(content).toBe(`Text [${WEB_ID}].`);
    expect(count).toBe(0);
  });

  it("starts footnote numbering at the requested offset", () => {
    const citations = [webCitation(WEB_ID, "Source", "https://example.com")];
    const { content } = applyNoteCitations(`More [${WEB_ID}].`, citations, 3);

    expect(content).toContain("More [^3].");
    expect(content).toContain("[^3]: [Source](https://example.com)");
  });
});

describe("maxFootnoteNumber", () => {
  it("returns the highest existing footnote number", () => {
    expect(maxFootnoteNumber("a [^1] b [^4] c\n[^4]: def")).toBe(4);
  });

  it("returns 0 when no footnotes are present", () => {
    expect(maxFootnoteNumber("plain text")).toBe(0);
  });
});
