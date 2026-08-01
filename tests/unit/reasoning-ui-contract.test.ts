import { readFileSync } from "fs";
import { resolve } from "path";
import { readStyles } from "../helpers/readStyles";

describe("reasoning transcript UI", () => {
  const transcript = [
    "ChatTranscript.ts",
    "assistantMessageRenderer.ts",
    "fetchTargetAnimator.ts",
    "workflowRenderer.ts",
    "workflow/reasoningNodeRenderer.ts",
    "workflow/toolCallNodeRenderer.ts",
    "workflow/fetchTargetResolver.ts",
    "citationAnchorRenderer.ts",
  ]
    .map((fileName) => readFileSync(resolve("src/apps/obsidian/ui/chat", fileName), "utf8"))
    .join("\n");
  const workflow = readFileSync(resolve("src/apps/obsidian/ui/chat/workflowRenderer.ts"), "utf8");
  const controller = readFileSync(
    resolve("src/apps/obsidian/ui/chat/research/ResearchQuestionController.ts"),
    "utf8",
  );
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
    expect(transcript).toContain("if (context.isDebugMode && view.inCell)");
    expect(transcript).toContain("if (context.isDebugMode && view.outCell)");
    expect(transcript).toContain('if (child.kind === "tool-call")');
  });

  it("renders an active Thinking timeline node while an assistant response is streaming", () => {
    expect(transcript).toContain("renderActiveThinkingNode");
    expect(transcript).toContain('progress?.phase === "streaming"');
    expect(transcript).toContain("!activeReasoningId");
    expect(transcript).toContain("ixplorer-chat__workflow-node--thinking-active");
    expect(styles).toContain("ixplorer-chat__workflow-node--thinking-active");
  });

  it("stops marking reasoning as active when a streamed answer checkpoint begins", () => {
    expect(transcript).toContain("const hasStreamingCheckpoint");
    expect(transcript).toContain("!hasStreamingCheckpoint");
    expect(transcript).toContain("chain.at(-1)");
  });

  it("shows Finalizing when final answer tokens arrive before the stream completes", () => {
    expect(transcript).toContain("isFinalizing");
    expect(transcript).toContain(
      'checkpoints.some((checkpoint) => checkpoint.status === "finalizing")',
    );
    expect(transcript).toContain('renderActiveThinkingNode(listEl, "Finalizing…")');
    expect(transcript).toContain('isFinalizing ? "finalizing" : "thinking"');
    expect(styles).toContain("ixplorer-chat__workflow-dot--finalizing");
    expect(controller).toContain("await this.waitForFinalizingFrame()");
  });

  it("renders at most one active workflow indicator", () => {
    expect(transcript).toContain("function renderWorkflowIndicator");
    expect(transcript).toContain("else if (isStreaming && !hasStreamingCheckpoint");
  });

  it("animates fetch targets one at a time instead of truncating their list", () => {
    expect(transcript).toContain("renderFetchTargets");
    expect(transcript).toContain("ixplorer-chat__tool-fetch-targets");
    expect(transcript).toContain("targetList.isConnected");
    expect(styles).toContain("ixplorer-chat__tool-fetch-target");
    expect(styles).toContain("ixplorer-chat__tool-fetch-target--active");
    expect(transcript).toContain('item.status === "pending"');
  });

  it("cancels fetch-target animations when the transcript rerenders or closes", () => {
    expect(transcript).toContain("disposeChatTranscript");
    expect(transcript).toContain("window.clearTimeout");
    expect(transcript).toContain("FetchTargetAnimator");
    expect(transcript).toContain("disposeFetchTargetAnimations");
  });

  it("passes workflow rendering only its direct dependencies", () => {
    expect(transcript).toContain("interface WorkflowRenderContext");
    expect(transcript).toContain("createWorkflowRenderContext");
    expect(workflow).not.toContain("options: ChatTranscriptOptions");
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
