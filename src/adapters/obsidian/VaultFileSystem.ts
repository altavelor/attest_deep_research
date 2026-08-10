import { DataAdapter, normalizePath } from "obsidian";
import { FileSystemEntry, FileSystemPort, FileSystemStat } from "@application/ports";
import { joinVaultPath, vaultBasename, vaultDirname } from "@shared";

const BACKUP_SUFFIX = "ixplorer-replaced";

/**
 * Vault-relative file system backed by Obsidian's `DataAdapter`. It is the only
 * storage path used by the indexing and chat stores, so the same code runs on
 * desktop and on mobile where Node built-ins are unavailable.
 */
export class VaultFileSystem implements FileSystemPort {
  private readonly replaceLocks = new Map<string, Promise<void>>();

  constructor(private readonly adapter: DataAdapter) {}

  async exists(path: string): Promise<boolean> {
    const target = this.resolve(path);

    if (await this.adapter.exists(target)) {
      return true;
    }

    await this.recoverInterruptedRename(target);

    return this.adapter.exists(target);
  }

  async stat(path: string): Promise<FileSystemStat | null> {
    const target = this.resolve(path);
    let stat = await this.adapter.stat(target);

    if (!stat) {
      await this.recoverInterruptedRename(target);
      stat = await this.adapter.stat(target);
    }

    if (!stat) {
      return null;
    }

    return {
      kind: stat.type,
      size: typeof stat.size === "number" ? stat.size : 0,
      modifiedTime: typeof stat.mtime === "number" ? stat.mtime : 0,
    };
  }

  /**
   * Lists a folder, first restoring any file left behind by an interrupted
   * replace. Backups are never reported: callers such as the chat list and the
   * index size report would otherwise miss a recoverable file or count it twice.
   */
  async list(path: string, allowRecovery = true): Promise<FileSystemEntry[]> {
    const listed = await this.adapter.list(this.resolve(path));
    const files = listed.files ?? [];
    const folders = listed.folders ?? [];
    const backups = files.filter((entry) => entry.endsWith(`.${BACKUP_SUFFIX}`));

    if (backups.length > 0 && allowRecovery) {
      for (const backup of backups) {
        await this.recoverInterruptedRename(backup.slice(0, -(BACKUP_SUFFIX.length + 1)));
      }

      return this.list(path, false);
    }

    return [
      ...files
        .filter((entry) => !entry.endsWith(`.${BACKUP_SUFFIX}`))
        .map((entry) => this.toEntry(entry, "file")),
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
    const target = this.resolve(path);

    try {
      return await this.adapter.read(target);
    } catch (error) {
      await this.recoverInterruptedRename(target);

      if (!(await this.adapter.exists(target))) {
        throw error;
      }

      return this.adapter.read(target);
    }
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
    const target = this.resolve(path);

    try {
      return new Uint8Array(await this.adapter.readBinary(target));
    } catch (error) {
      await this.recoverInterruptedRename(target);

      if (!(await this.adapter.exists(target))) {
        throw error;
      }

      return new Uint8Array(await this.adapter.readBinary(target));
    }
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

  /**
   * Replaces the target file. `DataAdapter.rename` refuses an existing target
   * and offers no atomic swap, so the previous file is kept under a backup name
   * until the replacement is in place; an interrupted call therefore leaves the
   * old file recoverable rather than leaving no file at all.
   */
  async rename(fromPath: string, toPath: string): Promise<void> {
    const source = this.resolve(fromPath);
    const target = this.resolve(toPath);
    await this.createFolder(vaultDirname(target));

    await this.withTargetLock(target, async () => {
      if (!(await this.adapter.exists(target))) {
        await this.adapter.rename(source, target);
        return;
      }

      const backup = `${target}.${BACKUP_SUFFIX}`;

      if (await this.adapter.exists(backup)) {
        await this.adapter.remove(backup);
      }

      await this.adapter.rename(target, backup);

      try {
        await this.adapter.rename(source, target);
      } catch (error) {
        await this.restoreBackup(backup, target);
        throw error;
      }

      await this.adapter.remove(backup);
    });
  }

  /** Puts the saved copy back, never masking the failure that triggered it. */
  private async restoreBackup(backup: string, target: string): Promise<void> {
    try {
      if (!(await this.adapter.exists(target))) {
        await this.adapter.rename(backup, target);
      }
    } catch {
      return;
    }
  }

  /** Serialises replaces of one path so concurrent writers cannot interleave. */
  private async withTargetLock(target: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.replaceLocks.get(target) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    this.replaceLocks.set(target, settled);

    try {
      await result;
    } finally {
      if (this.replaceLocks.get(target) === settled) {
        this.replaceLocks.delete(target);
      }
    }
  }

  /**
   * Restores a file left behind by a {@link rename} that was interrupted after
   * the previous file was moved aside. Reads fall back to it only after missing
   * the file, so the common path costs nothing and a failure here never turns a
   * read into an error.
   */
  private async recoverInterruptedRename(target: string): Promise<void> {
    const backup = `${target}.${BACKUP_SUFFIX}`;

    await this.withTargetLock(target, async () => {
      try {
        if (!(await this.adapter.exists(backup))) {
          return;
        }

        if (await this.adapter.exists(target)) {
          await this.adapter.remove(backup);
          return;
        }

        await this.adapter.rename(backup, target);
      } catch {
        return;
      }
    });
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
