import { DataAdapter, normalizePath } from "obsidian";
import { FileSystemEntry, FileSystemPort, FileSystemStat } from "@application/ports";
import { joinVaultPath, vaultBasename, vaultDirname } from "@shared";

/**
 * Vault-relative file system backed by Obsidian's `DataAdapter`. It is the only
 * storage path used by the indexing and chat stores, so the same code runs on
 * desktop and on mobile where Node built-ins are unavailable.
 */
export class VaultFileSystem implements FileSystemPort {
  constructor(private readonly adapter: DataAdapter) {}

  async exists(path: string): Promise<boolean> {
    return this.adapter.exists(this.resolve(path));
  }

  async stat(path: string): Promise<FileSystemStat | null> {
    const stat = await this.adapter.stat(this.resolve(path));

    if (!stat) {
      return null;
    }

    return {
      kind: stat.type,
      size: typeof stat.size === "number" ? stat.size : 0,
      modifiedTime: typeof stat.mtime === "number" ? stat.mtime : 0,
    };
  }

  async list(path: string): Promise<FileSystemEntry[]> {
    const listed = await this.adapter.list(this.resolve(path));
    const files = listed.files ?? [];
    const folders = listed.folders ?? [];

    return [
      ...files.map((entry) => this.toEntry(entry, "file")),
      ...folders.map((entry) => this.toEntry(entry, "folder")),
    ];
  }

  async createFolder(path: string): Promise<void> {
    const normalized = this.resolve(path);

    if (normalized === "" || (await this.adapter.exists(normalized))) {
      return;
    }

    await this.createFolder(vaultDirname(normalized));
    await this.adapter.mkdir(normalized);
  }

  async readText(path: string): Promise<string> {
    return this.adapter.read(this.resolve(path));
  }

  async *readTextLines(path: string): AsyncIterable<string> {
    const content = await this.readText(path);
    let start = 0;

    while (start <= content.length) {
      const index = content.indexOf("\n", start);

      if (index === -1) {
        const tail = content.slice(start);
        if (tail !== "") {
          yield stripCarriageReturn(tail);
        }
        return;
      }

      yield stripCarriageReturn(content.slice(start, index));
      start = index + 1;
    }
  }

  async readBinary(path: string): Promise<Uint8Array> {
    return new Uint8Array(await this.adapter.readBinary(this.resolve(path)));
  }

  async writeText(path: string, content: string): Promise<void> {
    const normalized = this.resolve(path);
    await this.createFolder(vaultDirname(normalized));
    await this.adapter.write(normalized, content);
  }

  async writeBinary(path: string, data: Uint8Array): Promise<void> {
    const normalized = this.resolve(path);
    await this.createFolder(vaultDirname(normalized));
    await this.adapter.writeBinary(normalized, toArrayBuffer(data));
  }

  async append(path: string, content: string): Promise<void> {
    const normalized = this.resolve(path);
    await this.createFolder(vaultDirname(normalized));
    await this.adapter.append(normalized, content);
  }

  async rename(fromPath: string, toPath: string): Promise<void> {
    const target = this.resolve(toPath);
    await this.createFolder(vaultDirname(target));

    if (await this.adapter.exists(target)) {
      await this.adapter.remove(target);
    }

    await this.adapter.rename(this.resolve(fromPath), target);
  }

  async remove(path: string): Promise<void> {
    await this.adapter.remove(this.resolve(path));
  }

  async removeFolder(path: string, options?: { recursive?: boolean }): Promise<void> {
    await this.adapter.rmdir(this.resolve(path), options?.recursive === true);
  }

  private resolve(path: string): string {
    const joined = joinVaultPath(path);

    return joined === "" ? "" : normalizePath(joined);
  }

  private toEntry(path: string, kind: FileSystemEntry["kind"]): FileSystemEntry {
    const normalized = joinVaultPath(path);

    return { path: normalized, name: vaultBasename(normalized), kind };
  }
}

function stripCarriageReturn(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}
