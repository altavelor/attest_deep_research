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
  const styles = readStyles();

  it("declares the workflow CSS classes the transcript renders", () => {
    expect(transcript).toContain('cls: "ixplorer-chat__workflow"');
    expect(transcript).toContain("ixplorer-chat__workflow-dot");
    expect(transcript).toContain('cls: "ixplorer-chat__answer-content"');
    expect(transcript).toContain("ixplorer-chat__message-content--workflow");
    expect(transcript).toContain("ixplorer-chat__tool-cell");
    expect(transcript).toContain("ixplorer-chat__tool-fetch-targets");
  });

  it("styles the workflow rail, dots, and edit diff", () => {
    expect(styles).toContain(".ixplorer-chat__workflow");
    expect(styles).toContain(".ixplorer-chat__workflow-dot--thinking");
    expect(styles).toContain(".ixplorer-chat__workflow-dot--tool");
    expect(styles).toContain(".ixplorer-chat__workflow-dot--finalizing");
    expect(styles).toContain(".ixplorer-chat__workflow-node--thinking-active");
    expect(styles).toContain(".ixplorer-chat__diff-line--add");
    expect(styles).toContain(".ixplorer-chat__diff-line--remove");
  });

  it("styles the answer status dot and the fetch-target list", () => {
    expect(styles).toContain(".ixplorer-chat__answer-status-dot");
    expect(styles).toContain("var(--color-green");
    expect(styles).toContain("ixplorer-chat__tool-fetch-target");
    expect(styles).toContain("ixplorer-chat__tool-fetch-target--active");
  });

  it("styles the user-message context block", () => {
    expect(styles).toContain(".ixplorer-chat__message-context");
  });

  it("declares the ellipsis and nowrap tool-description styles", () => {
    expect(styles).toContain("text-overflow: ellipsis");
    expect(styles).toContain("white-space: nowrap");
  });

  it("keeps the workflow renderer free of the transcript options type", () => {
    expect(transcript).toContain("interface WorkflowRenderContext");
    expect(transcript).toContain("createWorkflowRenderContext");
    expect(workflow).not.toContain("options: ChatTranscriptOptions");
  });
});
