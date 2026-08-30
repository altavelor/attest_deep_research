export class TAbstractFile {
  constructor(public path: string) {}
}

export class TFile extends TAbstractFile {
  stat: { size: number; mtime: number; ctime: number };
  extension: string;

  constructor(path = "", stat: { size?: number; mtime?: number } = {}) {
    super(path);
    const name = path.split("/").at(-1) ?? "";
    const dot = name.lastIndexOf(".");
    this.extension = dot >= 0 ? name.slice(dot + 1) : "";
    this.stat = { size: stat.size ?? 0, mtime: stat.mtime ?? 0, ctime: 0 };
  }
}

export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];
}

/**
 * In-memory `DataAdapter`. It keeps plugin storage inside the test process, so
 * no test reaches the real filesystem even though production code now writes
 * the index and chats through the vault adapter.
 */
export class MemoryDataAdapter {
  private readonly files = new Map<string, ArrayBuffer>();
  private readonly folders = new Set<string>();
  private readonly stats = new Map<string, { mtime: number }>();
  private clock = 1;

  getName(): string {
    return "memory";
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.folders.has(path);
  }

  async stat(
    path: string,
  ): Promise<{ type: "file" | "folder"; size: number; mtime: number; ctime: number } | null> {
    const file = this.files.get(path);

    if (file) {
      return {
        type: "file",
        size: file.byteLength,
        mtime: this.stats.get(path)?.mtime ?? 0,
        ctime: 0,
      };
    }

    return this.folders.has(path) ? { type: "folder", size: 0, mtime: 0, ctime: 0 } : null;
  }

  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    if (path !== "/" && path !== "" && !this.folders.has(path)) {
      throw new Error(`Folder not found: ${path}`);
    }

    const prefix = path === "/" || path === "" ? "" : `${path}/`;
    const isChild = (candidate: string) =>
      candidate.startsWith(prefix) && !candidate.slice(prefix.length).includes("/");

    return {
      files: [...this.files.keys()].filter(isChild),
      folders: [...this.folders].filter((candidate) => candidate !== path && isChild(candidate)),
    };
  }

  async mkdir(path: string): Promise<void> {
    this.folders.add(path);
  }

  async read(path: string): Promise<string> {
    return new TextDecoder().decode(await this.readBinary(path));
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    const file = this.files.get(path);

    if (!file) {
      throw new Error(`File not found: ${path}`);
    }

    return file;
  }

  async write(path: string, data: string): Promise<void> {
    await this.writeBinary(path, new TextEncoder().encode(data).slice().buffer as ArrayBuffer);
  }

  async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    this.files.set(path, data);
    this.stats.set(path, { mtime: this.clock });
    this.clock += 1;
  }

  async append(path: string, data: string): Promise<void> {
    const existing = this.files.has(path) ? await this.read(path) : "";
    await this.write(path, existing + data);
  }

  async rename(fromPath: string, toPath: string): Promise<void> {
    const file = this.files.get(fromPath);

    if (!file) {
      throw new Error(`File not found: ${fromPath}`);
    }

    await this.writeBinary(toPath, file);
    this.files.delete(fromPath);
    this.stats.delete(fromPath);
  }

  async remove(path: string): Promise<void> {
    if (!this.files.delete(path)) {
      throw new Error(`File not found: ${path}`);
    }

    this.stats.delete(path);
  }

  async rmdir(path: string, recursive: boolean): Promise<void> {
    if (!this.folders.has(path)) {
      throw new Error(`Folder not found: ${path}`);
    }

    const prefix = `${path}/`;
    const contained = [...this.files.keys(), ...this.folders].filter((candidate) =>
      candidate.startsWith(prefix),
    );

    if (contained.length > 0 && !recursive) {
      throw new Error(`Folder is not empty: ${path}`);
    }

    for (const candidate of contained) {
      this.files.delete(candidate);
      this.folders.delete(candidate);
      this.stats.delete(candidate);
    }

    this.folders.delete(path);
  }
}

/**
 * In-memory vault holding the files a test declares. Its adapter stores plugin
 * data in memory, so no test reaches the real filesystem.
 */
export interface VaultEventRef {
  event: string;
  handler: (...args: unknown[]) => void;
  detach(): void;
}

export class Vault {
  configDir = ".obsidian";
  adapter: unknown = new MemoryDataAdapter();
  private files: TFile[] = [];
  private readonly listeners: VaultEventRef[] = [];

  on(event: string, handler: (...args: unknown[]) => void): VaultEventRef {
    const ref: VaultEventRef = { event, handler, detach: () => this.offref(ref) };
    this.listeners.push(ref);
    return ref;
  }

  offref(ref: VaultEventRef): void {
    const index = this.listeners.indexOf(ref);
    if (index >= 0) this.listeners.splice(index, 1);
  }

  emit(event: string, ...args: unknown[]): void {
    for (const ref of [...this.listeners]) {
      if (ref.event === event) ref.handler(...args);
    }
  }

  listenerCount(event: string): number {
    return this.listeners.filter((ref) => ref.event === event).length;
  }

  setFiles(files: TFile[]): void {
    this.files = files;
  }

  getFiles(): TFile[] {
    return this.files;
  }

  getAbstractFileByPath(path: string): TAbstractFile | null {
    return this.files.find((file) => file.path === path) ?? null;
  }
}

/** Mirrors Obsidian's `normalizePath`: forward slashes, no leading or trailing slash. */
export function normalizePath(path: string): string {
  const normalized = path
    .replace(/([\\/])+/g, "/")
    .replace(/(^\/+|\/+$)/g, "")
    .trim();

  return normalized === "" ? "/" : normalized;
}
