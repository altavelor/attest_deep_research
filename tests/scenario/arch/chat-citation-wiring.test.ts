import { readFileSync } from "fs";

describe("chat rendering wiring", () => {
  it("linkifies url handles before the markdown renderer sees them", () => {
    const source = readFileSync("src/apps/obsidian/ui/chat/assistantMessageRenderer.ts", "utf8");
    expect(source).toContain("linkifyUrlCitations");
    expect(source).toContain("shortUrlCitationLabel");
    expect(source).toContain("answerMarkdown(message)");
  });
});
