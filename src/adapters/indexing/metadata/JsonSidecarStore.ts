import { FileSystemPort } from "@application/ports";
import { joinVaultPath, sha256Hex } from "@shared";

export class JsonSidecarStore<T extends { sourcePath: string }> {
  constructor(
    private readonly fileSystem: FileSystemPort,
    private readonly folder: string,
    private readonly subdirectory: string,
    private readonly isValid: (value: unknown) => value is T,
  ) {}

  async read(sourcePath: string): Promise<T | null> {
    try {
      const raw = await this.fileSystem.readText(this.fileFor(sourcePath));
      const parsed: unknown = JSON.parse(raw);
      return this.isValid(parsed) && parsed.sourcePath === sourcePath ? parsed : null;
    } catch {
      return null;
    }
  }

  async write(value: T): Promise<void> {
    await this.fileSystem.createFolder(this.dir());
    await this.fileSystem.writeText(this.fileFor(value.sourcePath), JSON.stringify(value, null, 2));
  }

  async list(): Promise<T[]> {
    let files: string[];
    try {
      files = (await this.fileSystem.list(this.dir()))
        .filter((entry) => entry.kind === "file")
        .map((entry) => entry.name);
    } catch {
      return [];
    }

    const items: T[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) {
        continue;
      }
      try {
        const parsed: unknown = JSON.parse(
          await this.fileSystem.readText(joinVaultPath(this.dir(), file)),
        );
        if (this.isValid(parsed)) {
          items.push(parsed);
        }
      } catch {
        continue;
      }
    }
    return items.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
  }

  private dir(): string {
    return joinVaultPath(this.folder, this.subdirectory);
  }

  private fileFor(sourcePath: string): string {
    const id = sha256Hex(sourcePath).slice(0, 32);
    return joinVaultPath(this.dir(), `${id}.json`);
  }
}
