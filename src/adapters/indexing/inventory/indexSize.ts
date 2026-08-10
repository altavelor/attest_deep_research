import { FileSystemEntry, FileSystemPort } from "@application/ports";

export async function measureFolderSize(
  fileSystem: FileSystemPort,
  path: string,
): Promise<number | null> {
  try {
    return await measureFolderSizeInner(fileSystem, path);
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

async function measureFolderSizeInner(fileSystem: FileSystemPort, path: string): Promise<number> {
  const entries = await fileSystem.list(path);
  const sizes = await Promise.all(entries.map((entry) => measureEntry(fileSystem, entry)));

  return sizes.reduce((total, size) => total + size, 0);
}

async function measureEntry(fileSystem: FileSystemPort, entry: FileSystemEntry): Promise<number> {
  if (entry.kind === "folder") {
    return measureFolderSizeInner(fileSystem, entry.path);
  }

  const stat = await fileSystem.stat(entry.path);

  return stat?.size ?? 0;
}
