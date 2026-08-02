import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

import { linkifyUrlCitations, shortUrlCitationLabel } from "@application/use-cases/research";
import {
  countAnchors,
  splitCitationText,
} from "@apps/obsidian/ui/chat/citations/citationTextParts";

const WIKI_URL =
  "https://ru.wikipedia.org/wiki/%D0%A1%D0%BE%D0%BB%D0%BD%D0%B5%D1%87%D0%BD%D0%B0%D1%8F_%D1%81%D0%B8%D1%81%D1%82%D0%B5%D0%BC%D0%B0";

describe("short link labels for web citations", () => {
  it("uses the decoded page title and host", () => {
    expect(shortUrlCitationLabel(WIKI_URL)).toBe("Солнечная система — ru.wikipedia.org");
  });

  it("falls back to the host when there is no path segment", () => {
    expect(shortUrlCitationLabel("https://www.example.com/")).toBe("example.com");
  });

  it("strips page extensions and clamps a long title", () => {
    expect(shortUrlCitationLabel("https://example.com/docs/getting_started.html")).toBe(
      "getting started — example.com",
    );
    expect(shortUrlCitationLabel(`https://example.com/${"a".repeat(120)}`).length).toBeLessThan(80);
  });

  it("tolerates malformed percent-encoding", () => {
    expect(shortUrlCitationLabel("https://example.com/%E0%A4%A")).toContain("example.com");
  });
});

describe("linkifying url citation handles", () => {
  it("turns a handle into a short clickable markdown link", () => {
    expect(linkifyUrlCitations(`[url:${WIKI_URL}]`, { label: shortUrlCitationLabel })).toBe(
      `[Солнечная система — ru.wikipedia.org](${WIKI_URL})`,
    );
  });

  it("keeps the full url as the label by default, so saved notes are unchanged", () => {
    expect(linkifyUrlCitations("[url:https://example.com/a]")).toBe(
      "[https://example.com/a](https://example.com/a)",
    );
  });

  it("leaves malformed and non-public handles untouched", () => {
    expect(linkifyUrlCitations("[url:not a url]")).toBe("[url:not a url]");
    expect(linkifyUrlCitations("[url:http://localhost/secret]")).toBe(
      "[url:http://localhost/secret]",
    );
  });

  it("escapes brackets so a label cannot terminate the link early", () => {
    expect(linkifyUrlCitations("[url:https://example.com/a]", { label: () => "a [b] c" })).toBe(
      "[a \\[b\\] c](https://example.com/a)",
    );
  });
});

describe("citation token splitting", () => {
  const knownId = "1234567890abcdef";
  const hasRef = (chunkId: string): boolean => chunkId === knownId;

  it("leaves a node without tokens untouched", () => {
    expect(splitCitationText("Plain answer text.", hasRef)).toBeNull();
  });

  it("replaces a known token with an anchor", () => {
    const parts = splitCitationText(`Claim [${knownId}] follows.`, hasRef);
    expect(parts).toEqual([
      { kind: "text", value: "Claim " },
      { kind: "anchor", chunkId: knownId },
      { kind: "text", value: " follows." },
    ]);
    expect(countAnchors(parts!)).toBe(1);
  });

  it("drops an unresolved token that starts the node, not only one mid-paragraph", () => {
    const leading = splitCitationText("[0000000000stale] trailing text", hasRef);
    expect(leading).not.toBeNull();
    expect(countAnchors(leading!)).toBe(0);
    expect(joinText(leading!)).toBe(" trailing text");

    const trailing = splitCitationText("leading text [0000000000stale]", hasRef);
    expect(joinText(trailing!)).toBe("leading text ");
  });

  it("drops a node consisting only of unresolved tokens", () => {
    const parts = splitCitationText("[0000000000stale]", hasRef);
    expect(parts).toEqual([]);
  });

  it("keeps short bracketed text that is not a citation handle", () => {
    expect(splitCitationText("see [note] here", hasRef)).toBeNull();
  });
});

describe("chat rendering wiring", () => {
  it("linkifies url handles before the markdown renderer sees them", () => {
    const source = readFileSync("src/apps/obsidian/ui/chat/assistantMessageRenderer.ts", "utf8");
    expect(source).toContain("linkifyUrlCitations");
    expect(source).toContain("shortUrlCitationLabel");
    expect(source).toContain("answerMarkdown(message)");
  });
});

function joinText(parts: ReturnType<typeof splitCitationText> & object): string {
  return parts
    .filter((part): part is { kind: "text"; value: string } => part.kind === "text")
    .map((part) => part.value)
    .join("");
}
