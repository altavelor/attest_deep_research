import { readFileSync } from "fs";
import { resolve } from "path";

describe("reasoning transcript UI", () => {
  const transcript = readFileSync(resolve("src/ui/ChatTranscript.ts"), "utf8");
  const styles = readFileSync(resolve("styles.css"), "utf8");

  it("renders one native research-progress disclosure separate from the answer", () => {
    expect(transcript).toContain('containerEl.createEl("details"');
    expect(transcript).toContain('cls: "ixplorer-chat__reasoning"');
    expect(transcript).toContain('cls: "ixplorer-chat__answer-content"');
    expect(transcript).toContain("Research progress");
    expect(transcript).toContain("message.researchProgress");
    expect(transcript).not.toContain("for (let index = 0; index < segments.length");
  });

  it("uses muted visual treatment for reasoning", () => {
    expect(styles).toContain(".ixplorer-chat__reasoning");
    expect(styles).toContain("color: var(--text-muted)");
    expect(styles).toContain("opacity: 0.82");
  });
});
