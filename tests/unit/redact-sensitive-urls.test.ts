import { redactSensitiveData } from "@shared/redactSensitiveData";

describe("redactSensitiveData URL boundaries", () => {
  it("leaves a quoted URL intact instead of swallowing the closing quote", () => {
    const line = '{"url":"https://en.wikipedia.org/wiki/Alphabet_Inc.","title":"x"}';

    expect(redactSensitiveData(line)).toBe(line);
    expect(String(redactSensitiveData(line))).not.toContain("%22");
  });

  it("keeps redacting secrets inside a quoted URL's query", () => {
    const line = '{"url":"https://api.example.com/v1?api_key=SECRET&page=2"}';
    const redacted = String(redactSensitiveData(line));

    expect(redacted).not.toContain("SECRET");
    expect(redacted).toContain("api_key=[redacted]");
    expect(redacted.endsWith('"}')).toBe(true);
  });

  it("does not eat the closing quote of a bearer token", () => {
    const line = '{"authorization":"Bearer abc123","next":"keep"}';
    const redacted = String(redactSensitiveData(line));

    expect(redacted).not.toContain("abc123");
    expect(redacted).toBe('{"authorization":"Bearer [redacted]","next":"keep"}');
  });

  it("still stops a bare URL at whitespace", () => {
    const redacted = String(redactSensitiveData("see https://example.com/a?token=T then stop"));

    expect(redacted).not.toContain("=T ");
    expect(redacted).toContain(" then stop");
  });
});

describe("redactSensitiveData with apostrophes in URLs", () => {
  it("runs the URL redactor over the whole URL when it contains an apostrophe", () => {
    const line = "https://api.example.com/search?q=o'brien&api_key=SECRET";
    const redacted = String(redactSensitiveData(line));

    expect(redacted).not.toContain("SECRET");
    expect(redacted).toContain("%27brien");
    expect(decodeURIComponent(redacted)).toContain("q=o'brien");
  });
});
