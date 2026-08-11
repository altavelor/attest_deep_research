import { sha256Hex } from "@shared";

export interface FileSnapshot {
  modifiedTime: number;
  contentHash: string;
}

export interface FileChangeCandidate {
  path: string;
  modifiedTime: number;
  contentHash?: string;
}

export function shouldIndexFile(
  snapshots: Map<string, FileSnapshot>,
  file: FileChangeCandidate,
): boolean {
  const snapshot = snapshots.get(file.path);

  if (!snapshot) {
    return true;
  }

  if (snapshot.modifiedTime === file.modifiedTime) {
    return false;
  }

  return file.contentHash === undefined || snapshot.contentHash !== file.contentHash;
}

export function updateSnapshot(
  snapshots: Map<string, FileSnapshot>,
  file: Required<FileChangeCandidate>,
): void {
  snapshots.set(file.path, {
    modifiedTime: file.modifiedTime,
    contentHash: file.contentHash,
  });
}

export function hashFileData(data: ArrayBuffer | string): string {
  return sha256Hex(data);
}
