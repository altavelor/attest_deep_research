import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assessWebTextQuality, canonicalizeWebEvidenceUrl } from "@core/web";

describe("canonicalizeWebEvidenceUrl", () => {
  it.each([
    ["https://www.example.com/article/", "https://example.com/article"],
    ["https://m.example.com/article", "https://example.com/article"],
    ["https://amp.example.com/article/amp/", "https://example.com/article"],
    ["https://example.com/article/amp.html", "https://example.com/article"],
    [
      "HTTPS://WWW.Example.COM:443/article/?utm_source=search&fbclid=fb&yclid=ya#method",
      "https://example.com/article",
    ],
  ])("canonicalizes equivalent web evidence URLs", (input, expected) => {
    expect(canonicalizeWebEvidenceUrl(input)).toBe(expected);
  });

  it("preserves meaningful query parameters and distinct pages on the same domain", () => {
    expect(canonicalizeWebEvidenceUrl("https://example.com/article?id=1&utm_medium=web")).toBe(
      "https://example.com/article?id=1",
    );
    expect(canonicalizeWebEvidenceUrl("https://example.com/article-a")).not.toBe(
      canonicalizeWebEvidenceUrl("https://example.com/article-b"),
    );
    expect(canonicalizeWebEvidenceUrl("https://example.com/amp")).toBe("https://example.com/amp");
    expect(canonicalizeWebEvidenceUrl("https://example.com/a//b")).not.toBe(
      canonicalizeWebEvidenceUrl("https://example.com/a/b"),
    );
  });
});

describe("assessWebTextQuality", () => {
  it("rejects text produced by decoding real non-UTF-8 bytes as UTF-8", () => {
    const encoded = readFileSync(
      join(__dirname, "..", "fixtures", "web", "russianfood-invalid-utf8.base64"),
      "utf8",
    ).trim();
    const bytes = Uint8Array.from(Buffer.from(encoded, "base64"));
    const mojibake = new TextDecoder("utf-8").decode(bytes);

    expect(mojibake).toContain("\uFFFD");
    expect(assessWebTextQuality(mojibake).readable).toBe(false);
  });

  it.each([
    ["CJK", "豆腐を水切りして、醤油と生姜を加えます。火を弱めて五分ほど煮込みます。"],
    ["formula", "For x ≥ 0, ∫₀∞ e^(−x²) dx = √π / 2, while E = mc² remains finite."],
    [
      "code",
      "const values = input.filter((value) => value !== null);\nreturn values.map(String).join(', ');",
    ],
    ["symbol-heavy JSON/code", '{"a":[],"b":{},"c":()}'],
  ])("accepts readable %s evidence", (_kind, text) => {
    expect(assessWebTextQuality(text).readable).toBe(true);
  });
});
