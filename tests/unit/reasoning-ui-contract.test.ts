import { readFileSync } from "fs";
import { resolve } from "path";

describe("reasoning transcript UI", () => {
  const transcript = readFileSync(resolve("src/apps/obsidian/ui/chat/ChatTranscript.ts"), "utf8");
  const styles = readFileSync(resolve("styles.css"), "utf8");

  it("renders reasoning, tools, and the answer as one unified workflow", () => {
    expect(transcript).toContain("renderWorkflowNodes");
    expect(transcript).toContain('cls: "ixplorer-chat__workflow"');
    expect(transcript).toContain("ixplorer-chat__workflow-dot");
    expect(transcript).toContain('cls: "ixplorer-chat__answer-content"');
    expect(transcript).toContain("message.researchProgress");
    expect(transcript).toContain("ixplorer-chat__message-content--workflow");
  });

  it("collapses long thinking blocks but keeps short ones inline", () => {
    expect(transcript).toContain("isLongThinking");
    expect(transcript).toContain('"data-thinking-id"');
    expect(transcript).toContain('text: "Thinking"');
    expect(transcript).toContain('text: "Thinking…"');
  });

  it("renders tool calls with In/Out cells", () => {
    expect(transcript).toContain("describeToolCall");
    expect(transcript).toContain('"In"');
    expect(transcript).toContain('"Out"');
    expect(transcript).toContain("ixplorer-chat__tool-cell");
  });

  it("styles the workflow rail, dots, and edit diff", () => {
    expect(styles).toContain(".ixplorer-chat__workflow");
    expect(styles).toContain(".ixplorer-chat__workflow-dot--thinking");
    expect(styles).toContain(".ixplorer-chat__workflow-dot--tool");
    expect(styles).toContain(".ixplorer-chat__diff-line--add");
    expect(styles).toContain(".ixplorer-chat__diff-line--remove");
  });
});
