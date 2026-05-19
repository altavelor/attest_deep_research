import { Dirent, promises as fs } from "fs";
import { join } from "path";

export async function measureFolderSize(path: string): Promise<number | null> {
  try {
    return await measureFolderSizeInner(path);
  } catch {
    return null;
  }
}

export function formatIndexSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) {
    return "Unavailable";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const formatted = (value >= 100 ? value.toFixed(0) : value.toFixed(1)).replace(/\.0$/, "");
  return `${formatted} ${units[unitIndex]}`;
}

async function measureFolderSizeInner(path: string): Promise<number> {
  const entries = await fs.readdir(path, { withFileTypes: true });
  const sizes = await Promise.all(entries.map((entry) => measureEntry(path, entry)));

  return sizes.reduce((total, size) => total + size, 0);
}

async function measureEntry(parentPath: string, entry: Dirent): Promise<number> {
  const entryPath = join(parentPath, entry.name);

  if (entry.isDirectory()) {
    return measureFolderSizeInner(entryPath);
  }

  if (!entry.isFile()) {
    return 0;
  }

  const stat = await fs.stat(entryPath);
  return stat.size;
}
