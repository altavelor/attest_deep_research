import { normalizeVaultPath } from "./pathFilters";

/**
 * Path helpers for vault-relative locations. They replace Node's `path` module
 * so the same code runs on desktop and on Obsidian Mobile, where no Node
 * built-ins exist.
 */

export function joinVaultPath(...segments: Array<string | undefined | null>): string {
  const parts: string[] = [];

  for (const segment of segments) {
    if (segment === undefined || segment === null) {
      continue;
    }

    for (const part of normalizeVaultPath(segment).split("/")) {
      if (part === "" || part === ".") {
        continue;
      }

      if (part === "..") {
        parts.pop();
        continue;
      }

      parts.push(part);
    }
  }

  return parts.join("/");
}

export function vaultDirname(path: string): string {
  const normalized = normalizeVaultPath(path).replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");

  return index <= 0 ? "" : normalized.slice(0, index);
}

export function vaultBasename(path: string, suffix?: string): string {
  const normalized = normalizeVaultPath(path).replace(/\/+$/, "");
  const name = normalized.slice(normalized.lastIndexOf("/") + 1);

  if (suffix && suffix !== name && name.endsWith(suffix)) {
    return name.slice(0, -suffix.length);
  }

  return name;
}

export function vaultExtname(path: string): string {
  const name = vaultBasename(path);
  const index = name.lastIndexOf(".");

  return index <= 0 ? "" : name.slice(index);
}

export function isInsideVaultFolder(folder: string, path: string): boolean {
  const normalizedFolder = joinVaultPath(folder);
  const normalizedPath = joinVaultPath(path);

  if (normalizedFolder === "") {
    return normalizedPath !== "";
  }

  return normalizedPath === normalizedFolder || normalizedPath.startsWith(`${normalizedFolder}/`);
}

/**
 * Joins a vault-relative base with an untrusted segment and rejects any result
 * that escapes the base. Use it for every path derived from external data such
 * as stored settings, file names inside archives, or model output.
 */
export function resolveInsideVaultFolder(
  folder: string,
  ...segments: Array<string | undefined | null>
): string {
  const base = joinVaultPath(folder);
  const candidate = joinVaultPath(base, ...segments);

  if (!isInsideVaultFolder(base, candidate) || candidate === base) {
    throw new Error(`Path escapes its vault folder: ${segments.join("/")}`);
  }

  return candidate;
}
