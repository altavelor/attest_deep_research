export class TAbstractFile {
  constructor(public path: string) {}
}

export class TFile extends TAbstractFile {
  stat: { size: number; mtime: number; ctime: number };

  constructor(path: string, stat: { size?: number; mtime?: number } = {}) {
    super(path);
    this.stat = { size: stat.size ?? 0, mtime: stat.mtime ?? 0, ctime: 0 };
  }
}

export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];
}

export class FileSystemAdapter {
  constructor(private readonly basePath = "/vault") {}

  getBasePath(): string {
    return this.basePath;
  }
}

/**
 * In-memory vault holding the files a test declares. Its adapter is not a
 * `FileSystemAdapter` until `useLocalPath` opts in, so no test reaches the
 * filesystem by accident.
 */
export class Vault {
  adapter: unknown = {};
  private files: TFile[] = [];

  setFiles(files: TFile[]): void {
    this.files = files;
  }

  useLocalPath(basePath: string): void {
    this.adapter = new FileSystemAdapter(basePath);
  }

  getFiles(): TFile[] {
    return this.files;
  }

  getAbstractFileByPath(path: string): TAbstractFile | null {
    return this.files.find((file) => file.path === path) ?? null;
  }
}
