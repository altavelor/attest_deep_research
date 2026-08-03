import { readFileSync } from "fs";
import { resolve } from "path";
import { readStyles } from "../helpers/readStyles";

describe("reasoning transcript static policy", () => {
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

  it("declares the unified workflow renderer and its CSS classes", () => {
    expect(transcript).toContain("renderWorkflowNodes");
    expect(transcript).toContain('cls: "ixplorer-chat__workflow"');
    expect(transcript).toContain("ixplorer-chat__workflow-dot");
    expect(transcript).toContain('cls: "ixplorer-chat__answer-content"');
    expect(transcript).toContain("message.researchProgress");
    expect(transcript).toContain("ixplorer-chat__message-content--workflow");
  });

  it("orders the answer-content class before the answer-header call in source", () => {
    expect(transcript.indexOf('cls: "ixplorer-chat__answer-content"')).toBeLessThan(
      transcript.indexOf("renderAssistantAnswerHeader(answerEl, message, options)"),
    );
    expect(transcript).toContain("function renderAssistantAnswerHeader");
  });

  it("declares the answer status dot class and its green style", () => {
    expect(transcript).toContain("ixplorer-chat__answer-status-dot");
    expect(styles).toContain(".ixplorer-chat__answer-status-dot");
    expect(styles).toContain("var(--color-green");
  });

  it("declares the long-thinking identifiers and labels", () => {
    expect(transcript).toContain("isLongThinking");
    expect(transcript).toContain('"data-thinking-id"');
    expect(transcript).toContain('text: "Thinking"');
    expect(transcript).toContain('text: "Thinking…"');
  });

  it("declares the In and Out tool-cell labels and classes", () => {
    expect(transcript).toContain("describeToolCall");
    expect(transcript).toContain('"In"');
    expect(transcript).toContain('"Out"');
    expect(transcript).toContain("ixplorer-chat__tool-cell");
  });

  it("declares the active thinking node identifiers and its style", () => {
    expect(transcript).toContain("renderActiveThinkingNode");
    expect(transcript).toContain('progress?.phase === "streaming"');
    expect(transcript).toContain("!activeReasoningId");
    expect(transcript).toContain("ixplorer-chat__workflow-node--thinking-active");
    expect(styles).toContain("ixplorer-chat__workflow-node--thinking-active");
  });

  it("declares the streaming-checkpoint identifiers", () => {
    expect(transcript).toContain("const hasStreamingCheckpoint");
    expect(transcript).toContain("!hasStreamingCheckpoint");
    expect(transcript).toContain("chain.at(-1)");
  });

  it("declares the finalizing identifiers, label, and style", () => {
    expect(transcript).toContain("isFinalizing");
    expect(transcript).toContain(
      'checkpoints.some((checkpoint) => checkpoint.status === "finalizing")',
    );
    expect(transcript).toContain('renderActiveThinkingNode(listEl, "Finalizing…")');
    expect(transcript).toContain('isFinalizing ? "finalizing" : "thinking"');
    expect(styles).toContain("ixplorer-chat__workflow-dot--finalizing");
    expect(controller).toContain("await this.waitForFinalizingFrame()");
  });

  it("declares the render call inside the checkpoint-promote branch", () => {
    const promotionStart = controller.indexOf('if (event.type === "checkpoint-promote")');
    const promotionEnd = controller.indexOf('if (event.type === "answer-reset")', promotionStart);
    const checkpointPromotion = controller.slice(promotionStart, promotionEnd);

    expect(checkpointPromotion).toContain("this.options.renderActiveMessage()");
  });

  it("declares a single workflow-indicator branch", () => {
    expect(transcript).toContain("function renderWorkflowIndicator");
    expect(transcript).toContain("else if (isStreaming && !hasStreamingCheckpoint");
  });

  it("declares the fetch-target classes and their active style", () => {
    expect(transcript).toContain("ixplorer-chat__tool-fetch-targets");
    expect(styles).toContain("ixplorer-chat__tool-fetch-target");
    expect(styles).toContain("ixplorer-chat__tool-fetch-target--active");
  });

  it("keeps the workflow renderer free of the transcript options type", () => {
    expect(transcript).toContain("interface WorkflowRenderContext");
    expect(transcript).toContain("createWorkflowRenderContext");
    expect(workflow).not.toContain("options: ChatTranscriptOptions");
  });

  it("declares the ellipsis and nowrap tool-description styles", () => {
    expect(styles).toContain("text-overflow: ellipsis");
    expect(styles).toContain("white-space: nowrap");
  });

  it("declares the workflow rail, dot, and diff styles", () => {
    expect(styles).toContain(".ixplorer-chat__workflow");
    expect(styles).toContain(".ixplorer-chat__workflow-dot--thinking");
    expect(styles).toContain(".ixplorer-chat__workflow-dot--tool");
    expect(styles).toContain(".ixplorer-chat__diff-line--add");
    expect(styles).toContain(".ixplorer-chat__diff-line--remove");
  });

  it("declares the user-message context identifiers and style", () => {
    expect(transcript).toContain("renderUserMessageContent");
    expect(transcript).toContain("message.contextPaths");
    expect(styles).toContain(".ixplorer-chat__message-context");
  });
});
