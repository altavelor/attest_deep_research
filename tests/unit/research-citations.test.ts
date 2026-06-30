import { describe, expect, it } from "vitest";
import {
  citationIdsFromText,
  resolveCitationTokens,
} from "../../src/application/use-cases/research/citations";

describe("citationIdsFromText", () => {
  it("extracts bracketed tokens verbatim", () => {
    const ids = citationIdsFromText("Claim [web:abc] and [doc:1] cite [web:abc].");
    expect([...ids].sort()).toEqual(["doc:1", "web:abc"]);
  });
});

describe("resolveCitationTokens", () => {
  const urlToEvidenceId = new Map<string, string>([
    ["https://openai.com/pricing", "web:hash-openai"],
    ["https://ai.google.dev/pricing", "web:hash-gemini"],
  ]);

  it("resolves [url:...] tokens to the registered evidence id", () => {
    const { ids, unresolvedUrls } = resolveCitationTokens(
      "GPT-4o is $2.50/1M [url:https://openai.com/pricing].",
      urlToEvidenceId,
    );
    expect([...ids]).toEqual(["web:hash-openai"]);
    expect(unresolvedUrls).toEqual([]);
  });

  it("canonicalizes the cited URL before lookup (drops fragment, default port)", () => {
    const { ids } = resolveCitationTokens(
      "see [url:https://openai.com:443/pricing#plans]",
      urlToEvidenceId,
    );
    expect([...ids]).toEqual(["web:hash-openai"]);
  });

  it("reports URLs that were cited but never gathered as unresolved", () => {
    const { ids, unresolvedUrls } = resolveCitationTokens(
      "per [url:https://example.com/unseen]",
      urlToEvidenceId,
    );
    expect(ids.size).toBe(0);
    expect(unresolvedUrls).toEqual(["https://example.com/unseen"]);
  });

  it("ignores raw evidence-id tokens", () => {
    const { ids } = resolveCitationTokens("raw [web:hash-gemini] cite", urlToEvidenceId);
    expect([...ids]).toEqual([]);
  });

  it("ignores malformed url tokens", () => {
    const { ids, unresolvedUrls } = resolveCitationTokens(
      "bad [url:not a url] token",
      urlToEvidenceId,
    );
    expect(ids.size).toBe(0);
    expect(unresolvedUrls).toEqual([]);
  });
});
