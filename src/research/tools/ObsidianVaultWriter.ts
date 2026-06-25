import { App, TFile } from "obsidian";
import { VaultWriter } from "./NoteTools";

export class ObsidianVaultWriter implements VaultWriter {
  constructor(private readonly app: App) { }

  async exists(path: string): Promise<boolean> {
    return this.app.vault.getAbstractFileByPath(path) instanceof TFile;
  }

  async createFile(path: string, content: string): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, content);
    } else {
      await this.app.vault.create(path, content);
    }
  }

  async modifyFile(path: string, content: string): Promise<void> {
    const file = this.requireFile(path);
    await this.app.vault.modify(file, content);
  }

  async appendFile(path: string, content: string): Promise<void> {
    const file = this.requireFile(path);
    await this.app.vault.append(file, content);
  }

  async readFile(path: string): Promise<string> {
    const file = this.requireFile(path);
    return this.app.vault.read(file);
  }

  async trashFile(path: string): Promise<void> {
    const file = this.requireFile(path);
    await this.app.vault.trash(file, true);
  }

  async ensureFolder(path: string): Promise<void> {
    if (!path || this.app.vault.getFolderByPath(path)) {
      return;
    }
    await this.app.vault.createFolder(path);
  }

  private requireFile(path: string): TFile {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      throw new Error(`File not found: ${path}`);
    }
    return file;
  }
}
