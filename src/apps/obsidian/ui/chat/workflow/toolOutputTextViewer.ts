import { toolTitle } from "@core/agent";
import type { ChainItem } from "@core/conversation";
import type { Translate } from "@adapters/i18n";

/** Shows a tool call's full payload as plain text inside a host element, never through Markdown or the vault. */
export class ToolOutputTextViewer {
  private viewerEl: HTMLElement | undefined;

  constructor(
    private readonly hostEl: HTMLElement,
    private readonly t: Translate,
  ) {}

  open(item: Extract<ChainItem, { kind: "tool-call" }>): void {
    this.close();
    const viewerEl = this.hostEl.createDiv({
      cls: "attest-chat__tool-output-viewer",
      attr: { role: "region", "aria-label": toolTitle(item.name) },
    });
    const header = viewerEl.createDiv({ cls: "attest-chat__tool-output-viewer-header" });
    header.createSpan({ cls: "attest-chat__tool-output-viewer-title", text: toolTitle(item.name) });
    const closeButton = header.createEl("button", {
      cls: "attest-chat__tool-output-viewer-close",
      text: this.t("chat.workflow.tool.closeOutput"),
    });
    closeButton.addEventListener("click", () => this.close());
    viewerEl.createEl("pre", { cls: "attest-chat__tool-output-viewer-text" }).textContent =
      payloadText(item);
    this.viewerEl = viewerEl;
  }

  close(): void {
    this.viewerEl?.remove();
    this.viewerEl = undefined;
  }
}

function payloadText(item: Extract<ChainItem, { kind: "tool-call" }>): string {
  const sections: string[] = [];
  if (item.args && Object.keys(item.args).length > 0) {
    sections.push(JSON.stringify(item.args, null, 2));
  }
  if (item.resultJson !== undefined) sections.push(prettyJson(item.resultJson));
  return sections.join("\n\n");
}

function prettyJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}
