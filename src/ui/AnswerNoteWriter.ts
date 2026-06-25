import { App, Notice } from "obsidian";

import {
  formatResearchAnswerAppendBlock,
  formatResearchAnswerNote,
  researchAnswerNotePath,
} from "../research/answerFormatter";
import { ResearchAnswer } from "../shared/types";

export class AnswerNoteWriter {
  constructor(private readonly app: App) { }

  async saveAnswerToNewNote(answer: ResearchAnswer): Promise<void> {
    const path = await this.nextAvailableNotePath(researchAnswerNotePath(answer));
    await this.ensureFolder(path);
    await this.app.vault.create(path, formatResearchAnswerNote(answer));
    new Notice("Saved Ixplorer answer to a new note.");
    await this.app.workspace.openLinkText(path, "", false);
  }

  async appendAnswerToActiveNote(answer: ResearchAnswer): Promise<void> {
    const activeFile = this.app.workspace.getActiveFile();

    if (!activeFile) {
      new Notice("Open a note before appending an Ixplorer answer.");
      return;
    }

    await this.app.vault.append(activeFile, formatResearchAnswerAppendBlock(answer));
    new Notice("Appended Ixplorer answer to the active note.");
  }

  private async ensureFolder(path: string): Promise<void> {
    const folder = path.split("/").slice(0, -1).join("/");

    if (!folder || this.app.vault.getFolderByPath(folder)) {
      return;
    }

    await this.app.vault.createFolder(folder);
  }

  private async nextAvailableNotePath(path: string): Promise<string> {
    if (!this.app.vault.getAbstractFileByPath(path)) {
      return path;
    }

    const extensionIndex = path.lastIndexOf(".");
    const base = extensionIndex === -1 ? path : path.slice(0, extensionIndex);
    const extension = extensionIndex === -1 ? "" : path.slice(extensionIndex);

    for (let index = 2; index < 1000; index += 1) {
      const candidate = `${base}-${index}${extension}`;

      if (!this.app.vault.getAbstractFileByPath(candidate)) {
        return candidate;
      }
    }

    return `${base}-${Date.now()}${extension}`;
  }
}
