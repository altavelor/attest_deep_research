import { readFileSync } from "fs";
import { resolve } from "path";
import { readStyles } from "../helpers/readStyles";

describe("reasoning transcript UI", () => {
  const transcript = readFileSync(resolve("src/apps/obsidian/ui/chat/ChatTranscript.ts"), "utf8");
  const styles = readStyles();

  it("renders reasoning, tools, and the answer as one unified workflow", () => {
    expect(transcript).toContain("renderWorkflowNodes");
    expect(transcript).toContain('cls: "ixplorer-chat__workflow"');
    expect(transcript).toContain("ixplorer-chat__workflow-dot");
    expect(transcript).toContain('cls: "ixplorer-chat__answer-content"');
    expect(transcript).toContain("message.researchProgress");
    expect(transcript).toContain("ixplorer-chat__message-content--workflow");
  });

  it("places assistant answer actions on the final answer element, after workflow rendering", () => {
    expect(transcript.indexOf('cls: "ixplorer-chat__answer-content"')).toBeLessThan(
      transcript.indexOf("renderAssistantAnswerHeader(answerEl, message, options)"),
    );
    expect(transcript).toContain("function renderAssistantAnswerHeader");
  });

  it("marks the final answer with a green dot", () => {
    expect(transcript).toContain("ixplorer-chat__answer-status-dot");
    expect(styles).toContain(".ixplorer-chat__answer-status-dot");
    expect(styles).toContain("var(--color-green");
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

  it("keeps reasoning and tool-call headers visible without Debug mode while hiding In/Out cells", () => {
    expect(transcript).toContain('if (item.kind === "tool-call")');
    expect(transcript).toContain('if (item.kind === "reasoning")');
    expect(transcript).not.toContain('item.kind === "reasoning" && options.isDebugMode');
    expect(transcript).toContain("if (options.isDebugMode && view.inCell)");
    expect(transcript).toContain("if (options.isDebugMode && view.outCell)");
    expect(transcript).toContain('if (child.kind === "tool-call")');
  });

  it("renders an active Thinking timeline node while an assistant response is streaming", () => {
    expect(transcript).toContain("renderActiveThinkingNode");
    expect(transcript).toContain('progress?.phase === "streaming"');
    expect(transcript).toContain("!activeReasoningId");
    expect(transcript).toContain("ixplorer-chat__workflow-node--thinking-active");
    expect(styles).toContain("ixplorer-chat__workflow-node--thinking-active");
  });

  it("shows Finalizing when final answer tokens arrive before the stream completes", () => {
    expect(transcript).toContain("isFinalizing");
    expect(transcript).toContain('checkpoint.status === "streaming"');
    expect(transcript).toContain('isFinalizing ? "Finalizing…" : "Thinking…"');
  });

  it("animates fetch targets one at a time instead of truncating their list", () => {
    expect(transcript).toContain("renderFetchTargets");
    expect(transcript).toContain("ixplorer-chat__tool-fetch-targets");
    expect(transcript).toContain("targetList.isConnected");
    expect(styles).toContain("ixplorer-chat__tool-fetch-target");
    expect(styles).toContain("ixplorer-chat__tool-fetch-target--active");
  });

  it("truncates non-fetch tool descriptions instead of wrapping them", () => {
    expect(styles).toContain("text-overflow: ellipsis");
    expect(styles).toContain("white-space: nowrap");
  });

  it("styles the workflow rail, dots, and edit diff", () => {
    expect(styles).toContain(".ixplorer-chat__workflow");
    expect(styles).toContain(".ixplorer-chat__workflow-dot--thinking");
    expect(styles).toContain(".ixplorer-chat__workflow-dot--tool");
    expect(styles).toContain(".ixplorer-chat__diff-line--add");
    expect(styles).toContain(".ixplorer-chat__diff-line--remove");
  });

  it("renders included context documents inside user messages", () => {
    expect(transcript).toContain("renderUserMessageContent");
    expect(transcript).toContain("message.contextPaths");
    expect(styles).toContain(".ixplorer-chat__message-context");
  });
});
