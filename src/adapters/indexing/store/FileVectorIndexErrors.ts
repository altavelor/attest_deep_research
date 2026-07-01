import { IxplorerError } from "@core/errors";

export function throwRebuildRequired(details: Record<string, unknown>): never {
  throw new IxplorerError({
    code: "INDEX_REBUILD_REQUIRED",
    message: "The file-backed index format is inconsistent.",
    details,
  });
}

export function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
