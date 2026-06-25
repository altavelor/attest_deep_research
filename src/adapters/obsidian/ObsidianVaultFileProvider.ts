import { TFile, Vault } from "obsidian";

import {
  VaultFileProvider,
  VaultFileSummary,
} from "../../indexing/IndexingService";
import { normalizeVaultPath, vaultPathMatchesGlob } from "../../shared/pathFilters";

export class ObsidianVaultFileProvider implements VaultFileProvider {
  constructor(private readonly vault: Vault) { }

  async listFiles(): Promise<VaultFileSummary[]> {
    const ignoredGlobs = this.getIgnoredGlobs();
    return this.vault
      .getFiles()
      .filter((file) => !isHiddenOrIgnoredVaultPath(file.path, ignoredGlobs))
      .map((file) => ({
        path: file.path,
        modifiedTime: file.stat.mtime,
        size: file.stat.size,
      }));
  }

  async readFile(path: string): Promise<ArrayBuffer | string> {
    const file = this.vault.getAbstractFileByPath(path);

    if (!(file instanceof TFile)) {
      return "";
    }

    return this.vault.readBinary(file);
  }

  private getIgnoredGlobs(): string[] {
    const vaultWithConfig = this.vault as Vault & { getConfig?(key: string): unknown };
    const value = vaultWithConfig.getConfig?.("userIgnoreFilters");
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  }
}

function isHiddenOrIgnoredVaultPath(path: string, ignoredGlobs: string[]): boolean {
  const normalized = normalizeVaultPath(path);
  if (normalized.split("/").some((segment) => segment.startsWith("."))) {
    return true;
  }

  return ignoredGlobs.some((glob) => vaultPathMatchesGlob(normalized, glob));
}
