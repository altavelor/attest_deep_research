import { describe, expect, it } from "vitest";
import {
  citationIdsFromText,
  normalizeCitationTokens,
} from "@application/use-cases/research/strategies/citations";

describe("citationIdsFromText", () => {
  it("extracts bracketed tokens verbatim", () => {
    const ids = citationIdsFromText("Claim [web:abc] and [doc:1] cite [web:abc].");
    expect([...ids].sort()).toEqual(["doc:1", "web:abc"]);
  });
});

describe("normalizeCitationTokens", () => {
  const urlToEvidenceId = new Map<string, string>([
    ["https://openai.com/pricing", "web:hash-openai"],
    ["https://ai.google.dev/pricing", "web:hash-gemini"],
  ]);

  it("rewrites [url:...] tokens into the registered evidence id", () => {
    const { text, ids, webReferences } = normalizeCitationTokens(
      "GPT-4o is $2.50/1M [url:https://openai.com/pricing].",
      urlToEvidenceId,
    );
    expect(text).toBe("GPT-4o is $2.50/1M [web:hash-openai].");
    expect([...ids]).toEqual(["web:hash-openai"]);
    expect(webReferences).toEqual([]);
  });

  it("canonicalizes the cited URL before lookup (drops fragment, default port)", () => {
    const { ids } = normalizeCitationTokens(
      "see [url:https://openai.com:443/pricing#plans]",
      urlToEvidenceId,
    );
    expect([...ids]).toEqual(["web:hash-openai"]);
  });

  it("resolves a mix of url tokens and evidence-id tokens in one answer", () => {
    const { text, ids } = normalizeCitationTokens(
      "Web says X [url:https://openai.com/pricing] and the vault says Y [web:hash-gemini].",
      urlToEvidenceId,
    );
    expect(text).toBe("Web says X [web:hash-openai] and the vault says Y [web:hash-gemini].");
    expect([...ids].sort()).toEqual(["web:hash-gemini", "web:hash-openai"]);
  });

  it("collapses a link and an evidence id for the same source into one token", () => {
    const { text, collapsedOccurrences, collapsedByLabel } = normalizeCitationTokens(
      "Claim [url:https://openai.com/pricing] [web:hash-openai] holds.",
      urlToEvidenceId,
    );
    expect(text).toBe("Claim [web:hash-openai] holds.");
    expect(collapsedOccurrences).toBe(1);
    expect(collapsedByLabel).toEqual({ "web:hash-openai": 1 });
  });

  it("keeps two pages of one domain as two distinct sources", () => {
    const index = new Map<string, string>([
      ["https://example.com/a", "web:a"],
      ["https://example.com/b", "web:b"],
    ]);
    const { text, ids } = normalizeCitationTokens(
      "First [url:https://example.com/a][url:https://example.com/b] second.",
      index,
    );
    expect(text).toBe("First [web:a][web:b] second.");
    expect([...ids].sort()).toEqual(["web:a", "web:b"]);
  });

  it("turns a cited page without evidence into a numbered web reference", () => {
    const { text, ids, webReferences } = normalizeCitationTokens(
      "per [url:https://example.com/unseen] and again [url:https://example.com/unseen]",
      urlToEvidenceId,
    );
    expect(text).toBe("per [web-ref-1] and again [web-ref-1]");
    expect(webReferences).toEqual([{ id: "web-ref-1", url: "https://example.com/unseen" }]);
    expect([...ids]).toEqual([]);
  });

  it("drops a destination whose url contains nested parentheses", () => {
    const wiki = "https://en.wikipedia.org/wiki/Mercury_(planet)";
    const index = new Map<string, string>([[wiki, "web:hash-mercury"]]);
    const { text } = normalizeCitationTokens(`See [url:${wiki}](${wiki}).`, index);
    expect(text).toBe("See [web:hash-mercury].");
  });

  it("keeps parenthesised prose that follows a token", () => {
    const { text } = normalizeCitationTokens(
      "Claim [web:hash-gemini](see the appendix) holds.",
      urlToEvidenceId,
    );
    expect(text).toBe("Claim [web:hash-gemini](see the appendix) holds.");
  });

  it("keeps ordinary bracketed prose out of the citations", () => {
    const { text, ids } = normalizeCitationTokens("note [Important note] and [ok]", new Map());
    expect(text).toBe("note [Important note] and [ok]");
    expect(ids.size).toBe(0);
  });

  it("does not mistake a markdown link label for a citation handle", () => {
    const { text, ids } = normalizeCitationTokens(
      "See [example.com/pricing](https://example.com/pricing).",
      urlToEvidenceId,
    );
    expect(text).toBe("See [example.com/pricing](https://example.com/pricing).");
    expect(ids.size).toBe(0);
  });

  it("drops the markdown destination of a url handle written as a link", () => {
    const { text, ids } = normalizeCitationTokens(
      "See [url:https://openai.com/pricing](https://openai.com/pricing).",
      urlToEvidenceId,
    );
    expect(text).toBe("See [web:hash-openai].");
    expect([...ids]).toEqual(["web:hash-openai"]);
  });

  it("leaves no link behind for a cited page without evidence written as a link", () => {
    const { text, webReferences } = normalizeCitationTokens(
      "See [url:https://example.com/unseen](https://example.com/unseen).",
      urlToEvidenceId,
    );
    expect(text).toBe("See [web-ref-1].");
    expect(text).not.toContain("https://example.com/unseen)");
    expect(webReferences).toEqual([{ id: "web-ref-1", url: "https://example.com/unseen" }]);
  });

  it("leaves malformed url tokens untouched", () => {
    const { text, ids, webReferences } = normalizeCitationTokens(
      "bad [url:not a url] token",
      urlToEvidenceId,
    );
    expect(text).toBe("bad [url:not a url] token");
    expect(ids.size).toBe(0);
    expect(webReferences).toEqual([]);
  });
});
