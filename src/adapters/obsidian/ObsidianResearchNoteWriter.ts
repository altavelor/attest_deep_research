import { App, TFolder } from "obsidian";
import type { ResearchNoteWriter } from "@application/ports";

/**
 * Creates research notes through the Obsidian vault. A path taken by any file or folder counts as
 * existing, and a create that loses a race to another file reports the collision instead of writing.
 */
export class ObsidianResearchNoteWriter implements ResearchNoteWriter {
  constructor(private readonly app: App) {}

  async exists(path: string): Promise<boolean> {
    return this.app.vault.getAbstractFileByPath(path) !== null;
  }

  async ensureFolder(path: string): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFolder) return;
    if (existing) throw new Error(`The export folder is a file: ${path}`);
    await this.app.vault.createFolder(path);
  }

  async createNew(path: string, content: string): Promise<boolean> {
    if (await this.exists(path)) return false;
    try {
      await this.app.vault.create(path, content);
      return true;
    } catch (error) {
      if (await this.exists(path)) return false;
      throw error;
    }
  }
}
