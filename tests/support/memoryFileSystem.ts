import { FileSystemEntry, FileSystemPort, FileSystemStat } from "@application/ports";
import { joinVaultPath, vaultBasename, vaultDirname } from "@shared";

/**
 * In-memory {@link FileSystemPort} for tests. It mirrors the contract the
 * Obsidian-backed adapter provides: writes create missing parent folders,
 * reads of absent paths reject, and listing an unknown folder rejects.
 */
export class MemoryFileSystem implements FileSystemPort {
  private readonly files = new Map<string, Uint8Array>();
  private readonly folders = new Set<string>();
  private readonly modifiedTimes = new Map<string, number>();
  private clock = 1;

  async exists(path: string): Promise<boolean> {
    const key = joinVaultPath(path);

    return this.files.has(key) || this.folders.has(key);
  }

  async stat(path: string): Promise<FileSystemStat | null> {
    const key = joinVaultPath(path);
    const file = this.files.get(key);

    if (file) {
      return { kind: "file", size: file.length, modifiedTime: this.modifiedTimes.get(key) ?? 0 };
    }

    return this.folders.has(key) ? { kind: "folder", size: 0, modifiedTime: 0 } : null;
  }

  async list(path: string): Promise<FileSystemEntry[]> {
    const key = joinVaultPath(path);

    if (key !== "" && !this.folders.has(key)) {
      throw new Error(`Folder not found: ${key}`);
    }

    const entries: FileSystemEntry[] = [];

    for (const candidate of [...this.folders, ...this.files.keys()]) {
      if (candidate === key || vaultDirname(candidate) !== key) {
        continue;
      }

      entries.push({
        path: candidate,
        name: vaultBasename(candidate),
        kind: this.files.has(candidate) ? "file" : "folder",
      });
    }

    return entries;
  }

  async createFolder(path: string): Promise<void> {
    let current = joinVaultPath(path);

    while (current !== "") {
      this.folders.add(current);
      current = vaultDirname(current);
    }
  }

  async readText(path: string): Promise<string> {
    return new TextDecoder().decode(await this.readBinary(path));
  }

  async *readTextLines(path: string): AsyncIterable<string> {
    const content = await this.readText(path);

    for (const line of content.split("\n")) {
      yield line.endsWith("\r") ? line.slice(0, -1) : line;
    }
  }

  async readBinary(path: string): Promise<Uint8Array> {
    const key = joinVaultPath(path);
    const file = this.files.get(key);

    if (!file) {
      throw new Error(`File not found: ${key}`);
    }

    return file;
  }

  async writeText(path: string, content: string): Promise<void> {
    await this.writeBinary(path, new TextEncoder().encode(content));
  }

  async writeBinary(path: string, data: Uint8Array): Promise<void> {
    const key = joinVaultPath(path);
    await this.createFolder(vaultDirname(key));
    this.files.set(key, new Uint8Array(data));
    this.modifiedTimes.set(key, this.clock);
    this.clock += 1;
  }

  async append(path: string, content: string): Promise<void> {
    const key = joinVaultPath(path);
    const existing = this.files.get(key);
    const suffix = new TextEncoder().encode(content);

    if (!existing) {
      await this.writeBinary(key, suffix);
      return;
    }

    const merged = new Uint8Array(existing.length + suffix.length);
    merged.set(existing);
    merged.set(suffix, existing.length);
    await this.writeBinary(key, merged);
  }

  async rename(fromPath: string, toPath: string): Promise<void> {
    const from = joinVaultPath(fromPath);
    const to = joinVaultPath(toPath);
    const file = this.files.get(from);

    if (!file) {
      throw new Error(`File not found: ${from}`);
    }

    await this.writeBinary(to, file);
    this.files.delete(from);
    this.modifiedTimes.delete(from);
  }

  async remove(path: string): Promise<void> {
    const key = joinVaultPath(path);

    if (!this.files.delete(key)) {
      throw new Error(`File not found: ${key}`);
    }

    this.modifiedTimes.delete(key);
  }

  async removeFolder(path: string, options?: { recursive?: boolean }): Promise<void> {
    const key = joinVaultPath(path);

    if (!this.folders.has(key)) {
      throw new Error(`Folder not found: ${key}`);
    }

    const prefix = `${key}/`;
    const contained = [...this.files.keys(), ...this.folders].filter((candidate) =>
      candidate.startsWith(prefix),
    );

    if (contained.length > 0 && options?.recursive !== true) {
      throw new Error(`Folder is not empty: ${key}`);
    }

    for (const candidate of contained) {
      this.files.delete(candidate);
      this.folders.delete(candidate);
      this.modifiedTimes.delete(candidate);
    }

    this.folders.delete(key);
  }

  /** Paths of every stored file, for assertions about on-disk layout. */
  filePaths(): string[] {
    return [...this.files.keys()].sort();
  }
}
