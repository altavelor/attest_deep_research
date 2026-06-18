import { SkillFileStore } from "./SkillRegistry";

interface VaultAdapterLike {
  exists(path: string): Promise<boolean>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  mkdir(path: string): Promise<void>;
}

export class ObsidianSkillFileStore implements SkillFileStore {
  constructor(private readonly adapter: VaultAdapterLike) {}

  exists(path: string): Promise<boolean> {
    return this.adapter.exists(path);
  }

  list(path: string): Promise<{ files: string[]; folders: string[] }> {
    return this.adapter.list(path);
  }

  read(path: string): Promise<string> {
    return this.adapter.read(path);
  }

  write(path: string, content: string): Promise<void> {
    return this.adapter.write(path, content);
  }

  mkdir(path: string): Promise<void> {
    return this.adapter.mkdir(path);
  }
}
