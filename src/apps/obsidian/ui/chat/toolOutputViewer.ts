import { App, Notice, TFile } from "obsidian";

import type { Translate } from "@adapters/i18n";

export interface ToolOutputDetail {
  name: string;
  intent: string;
  status: "pending" | "complete" | "failed";
  args?: Record<string, unknown>;
  resultJson?: string;
}

/**
 * Opens the full, untruncated output of a tool call in a tab in the main
 * window. The inline transcript only shows a 3-line preview (debug mode); the
 * complete arguments and result live here so the model's raw I/O stays
 * inspectable without a scrollbar cluttering the chat.
 *
 * A single reusable scratch note is overwritten on each click to avoid
 * littering the vault with one file per tool call.
 */
export class ToolOutputViewer {
  private static readonly NOTE_PATH = "Attest/tool-output.md";

  constructor(
    private readonly app: App,
    private readonly t: Translate,
  ) {}

  async open(detail: ToolOutputDetail): Promise<void> {
    const content = formatToolOutputNote(detail);
    const file = await this.writeScratchNote(content);
    if (!file) return;
    await this.app.workspace.getLeaf("tab").openFile(file);
  }

  private async writeScratchNote(content: string): Promise<TFile | undefined> {
    const path = ToolOutputViewer.NOTE_PATH;
    await this.ensureFolder(path);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, content);
      return existing;
    }
    try {
      return await this.app.vault.create(path, content);
    } catch (error) {
      new Notice(this.t("chat.toolOutput.openFailed", { error: String(error) }));
      return undefined;
    }
  }

  private async ensureFolder(path: string): Promise<void> {
    const folder = path.split("/").slice(0, -1).join("/");
    if (!folder || this.app.vault.getFolderByPath(folder)) return;
    await this.app.vault.createFolder(folder);
  }
}

function formatToolOutputNote(detail: ToolOutputDetail): string {
  const lines: string[] = [
    `# ${detail.name}`,
    "",
    `> ${detail.intent}`,
    "",
    `**Status:** ${detail.status}`,
  ];
  if (detail.args && Object.keys(detail.args).length > 0) {
    lines.push("", "## Arguments", "", "```json", prettyJson(JSON.stringify(detail.args)), "```");
  }
  if (detail.resultJson) {
    lines.push("", "## Result", "", "```json", prettyJson(detail.resultJson), "```");
  }
  return lines.join("\n") + "\n";
}

function prettyJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}
