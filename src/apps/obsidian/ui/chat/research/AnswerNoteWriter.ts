import { App, Notice, TFolder } from "obsidian";

import {
  formatResearchAnswerAppendBlock,
  formatResearchAnswerNote,
  researchAnswerNotePath,
} from "@application/use-cases/research";
import { ResearchAnswer } from "@core/answer";
import type { Translate } from "@adapters/i18n";

export class AnswerNoteWriter {
  constructor(
    private readonly app: App,
    private readonly t: Translate,
  ) {}

  async saveAnswerToNewNote(answer: ResearchAnswer): Promise<void> {
    const path = await this.nextAvailableNotePath(researchAnswerNotePath(answer));
    await this.ensureFolder(path);
    await this.app.vault.create(path, formatResearchAnswerNote(answer));
    new Notice(this.t("chat.answerNote.saved"));
    await this.app.workspace.openLinkText(path, "", false);
  }

  async appendAnswerToActiveNote(answer: ResearchAnswer): Promise<void> {
    const activeFile = this.app.workspace.getActiveFile();

    if (!activeFile) {
      new Notice(this.t("chat.answerNote.openNoteFirst"));
      return;
    }

    await this.app.vault.append(activeFile, formatResearchAnswerAppendBlock(answer));
    new Notice(this.t("chat.answerNote.appended"));
  }

  private async ensureFolder(path: string): Promise<void> {
    const folder = path.split("/").slice(0, -1).join("/");

    if (!folder || this.app.vault.getAbstractFileByPath(folder) instanceof TFolder) {
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
