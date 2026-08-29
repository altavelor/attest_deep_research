import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  extractReadableText,
  isDuckDuckGoChallengePage,
  parseDuckDuckGoResults,
} from "@adapters/web";

describe("DuckDuckGoParser", () => {
  it("parses block result fixtures with decoded redirect urls and cleaned text", () => {
    expect(parseDuckDuckGoResults(fixture("duckduckgo-results.html"))).toEqual([
      {
        title: "Example research",
        url: "https://example.com/research?q=local",
        snippet: 'A concise result about "local" models.',
      },
      {
        title: "Second result",
        url: "https://second.example.com/",
        snippet: "A second concise result.",
      },
    ]);
  });

  it("falls back to legacy anchor parsing when result blocks are absent", () => {
    expect(parseDuckDuckGoResults(fixture("duckduckgo-legacy-results.html"))).toEqual([
      {
        title: "Legacy result",
        url: "https://example.com/legacy",
        snippet: "Legacy snippet with 'entity' text.",
      },
    ]);
  });

  it("recognises the anti-bot challenge page that parses to zero results", () => {
    const challenge = fixture("duckduckgo-anomaly.html");

    expect(parseDuckDuckGoResults(challenge)).toEqual([]);
    expect(isDuckDuckGoChallengePage(challenge)).toBe(true);
  });

  it("does not treat a regular result page as a challenge", () => {
    expect(isDuckDuckGoChallengePage(fixture("duckduckgo-results.html"))).toBe(false);
  });

  it("extracts readable text from fetched pages and removes ignored content", () => {
    expect(extractReadableText(fixture("search-result-page.html"), 10_000)).toBe(
      "Example research Local model research First useful paragraph. Second useful paragraph.",
    );
  });

  it("bounds extracted readable text", () => {
    expect(extractReadableText("<p>alpha beta gamma</p>", 10)).toBe("alpha beta");
  });
});

function fixture(name: string): string {
  return readFileSync(join(__dirname, "..", "fixtures", "web", name), "utf8");
}
