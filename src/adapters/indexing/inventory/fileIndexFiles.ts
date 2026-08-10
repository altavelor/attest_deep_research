import { FileSystemPort } from "@application/ports";
import { IxplorerError } from "@core/errors";

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
  fs: FileSystemPort,
  path: string,
  isValid: (value: unknown) => value is T,
  fallback: T,
): Promise<T> {
  let content: string;

  try {
    if (!(await fs.exists(path))) {
      return fallback;
    }

    content = await fs.readText(path);
  } catch (error) {
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
  fs: FileSystemPort,
  path: string,
  isValid: (value: unknown) => value is T,
): Promise<T[]> {
  let content: string;

  try {
    if (!(await fs.exists(path))) {
      return [];
    }

    content = await fs.readText(path);
  } catch (error) {
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

export async function readFirstJsonlIndexRows<T>(
  fs: FileSystemPort,
  path: string,
  isValid: (value: unknown) => value is T,
  limit: number,
): Promise<T[]> {
  if (limit <= 0) {
    return [];
  }

  const rows: T[] = [];

  try {
    if (!(await fs.exists(path))) {
      return [];
    }

    for await (const line of fs.readTextLines(path)) {
      if (!line.trim()) {
        continue;
      }

      const parsed: unknown = JSON.parse(line);

      if (!isValid(parsed)) {
        throw new Error("JSONL row did not match the expected index schema.");
      }

      rows.push(parsed);

      if (rows.length >= limit) {
        break;
      }
    }
  } catch (error) {
    throwIndexReadError(error, path);
  }

  return rows;
}

export async function readBinaryIndexFile(fs: FileSystemPort, path: string): Promise<Uint8Array> {
  try {
    if (!(await fs.exists(path))) {
      return new Uint8Array();
    }

    return await fs.readBinary(path);
  } catch (error) {
    throwIndexReadError(error, path);
  }
}

export async function atomicWriteIndexFiles(
  fs: FileSystemPort,
  commit: AtomicIndexCommit,
): Promise<void> {
  for (const file of commit.files) {
    await atomicWriteFile(fs, file, commit.writeId);
  }

  await atomicWriteFile(fs, commit.manifest, commit.writeId);
}

async function atomicWriteFile(
  fs: FileSystemPort,
  file: AtomicIndexFile,
  writeId: string,
): Promise<void> {
  const tempPath = `${file.path}.${writeId}.tmp`;

  if (typeof file.data === "string") {
    await fs.writeText(tempPath, file.data);
  } else {
    await fs.writeBinary(tempPath, file.data);
  }

  await fs.rename(tempPath, file.path);
}

function throwIndexReadError(cause: unknown, path: string): never {
  throw new IxplorerError({
    code: "INDEX_REBUILD_REQUIRED",
    message: "The file-backed index could not be read.",
    cause,
    details: { path },
  });
}
