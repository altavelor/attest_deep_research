import { TFile, Vault } from "obsidian";

import { normalizeVaultPath } from "../shared/pathFilters";
import { ContextFileProvider } from "./ContextAssembler";

export class ObsidianContextFileProvider implements ContextFileProvider {
  constructor(private readonly vault: Vault) {}

  async listPaths(): Promise<string[]> {
    return this.vault
      .getFiles()
      .filter((file) => isSupportedContextPath(file.path))
      .map((file) => normalizeVaultPath(file.path))
      .sort();
  }

  async readFile(path: string): Promise<ArrayBuffer | string> {
    const file = this.vault.getAbstractFileByPath(path);

    if (!(file instanceof TFile)) {
      return "";
    }

    return this.vault.readBinary(file);
  }

  async getModifiedTime(path: string): Promise<number> {
    const file = this.vault.getAbstractFileByPath(path);

    return file instanceof TFile ? file.stat.mtime : 0;
  }
}

function isSupportedContextPath(path: string): boolean {
  return /\.(md|pdf|txt|docx|epub|fb2)$/i.test(path);
}
