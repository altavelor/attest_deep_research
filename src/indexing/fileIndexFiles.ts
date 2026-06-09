import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { dirname } from "path";

import { IxplorerError } from "../shared/errors";

export interface AtomicIndexFile {
  path: string;
  data: string | Uint8Array;
}

export interface AtomicIndexCommit {
  files: AtomicIndexFile[];
  manifest: AtomicIndexFile;
  writeId: string;
}

export async function readJsonIndexFile<T>(
  path: string,
  isValid: (value: unknown) => value is T,
  fallback: T,
): Promise<T> {
  let content: string;

  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return fallback;
    }

    throwIndexReadError(error, path);
  }

  try {
    const parsed: unknown = JSON.parse(content);

    if (!isValid(parsed)) {
      throw new Error("JSON did not match the expected index schema.");
    }

    return parsed;
  } catch (error) {
    throwIndexReadError(error, path);
  }
}

export async function readJsonlIndexFile<T>(
  path: string,
  isValid: (value: unknown) => value is T,
): Promise<T[]> {
  let content: string;

  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }

    throwIndexReadError(error, path);
  }

  const rows: T[] = [];
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);

  for (const line of lines) {
    try {
      const parsed: unknown = JSON.parse(line);

      if (!isValid(parsed)) {
        throw new Error("JSONL row did not match the expected index schema.");
      }

      rows.push(parsed);
    } catch (error) {
      throwIndexReadError(error, path);
    }
  }

  return rows;
}

export async function readBinaryIndexFile(path: string): Promise<Uint8Array> {
  try {
    return new Uint8Array(await readFile(path));
  } catch (error) {
    if (isMissingFileError(error)) {
      return new Uint8Array();
    }

    throwIndexReadError(error, path);
  }
}

export async function atomicWriteIndexFiles(commit: AtomicIndexCommit): Promise<void> {
  for (const file of commit.files) {
    await atomicWriteFile(file, commit.writeId);
  }

  await atomicWriteFile(commit.manifest, commit.writeId);
}

async function atomicWriteFile(file: AtomicIndexFile, writeId: string): Promise<void> {
  await mkdir(dirname(file.path), { recursive: true });
  const tempPath = `${file.path}.${writeId}.tmp`;
  await writeFile(tempPath, file.data);
  await rename(tempPath, file.path);
}

function throwIndexReadError(cause: unknown, path: string): never {
  throw new IxplorerError({
    code: "INDEX_REBUILD_REQUIRED",
    message: "The file-backed index could not be read.",
    cause,
    details: { path },
  });
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
