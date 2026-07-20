// Shared helpers for the document-download tools: path/filename resolution,
// content-type gating, size budget and the user-confirmation hook. Pure and
// I/O-free so both the download tool and its tests can share them.

import { normalizeVaultPath } from "@shared";

/** Hard ceiling on a single downloaded document. Keeps the vault (and memory) sane. */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

/** Permission names a run may grant for download tools; mapped from availability. */
export const DOWNLOAD_PERMISSIONS = {
  write: "download.write",
} as const;

/** Requested download the user is asked to confirm before it touches the vault. */
export interface DownloadActionRequest {
  url: string;
  path: string;
  bytes: number;
  contentType: string;
}

export interface DownloadConfirmation {
  confirm(request: DownloadActionRequest): Promise<boolean>;
}

export const AUTO_CONFIRM_DOWNLOAD: DownloadConfirmation = {
  confirm: async () => true,
};

/** Map a normalized content-type onto the file extension used when none is in the URL. */
const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "application/x-pdf": "pdf",
  "application/epub+zip": "epub",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/rtf": "rtf",
  "text/plain": "txt",
};

export function normalizeContentType(value: string | null | undefined): string {
  return (value ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

export function extensionForContentType(contentType: string): string | undefined {
  return CONTENT_TYPE_EXTENSIONS[normalizeContentType(contentType)];
}

/** Whether a content-type is one we offer to download (primarily PDFs). */
export function isDownloadableContentType(contentType: string): boolean {
  const normalized = normalizeContentType(contentType);
  return (
    normalized in CONTENT_TYPE_EXTENSIONS ||
    normalized === "application/octet-stream" ||
    normalized === ""
  );
}

/**
 * Derive a safe, extension-bearing filename from the URL, the optional
 * Content-Disposition filename, and the content-type. Never returns a path —
 * only a single path segment.
 */
export function deriveFilename(
  url: string,
  contentDisposition: string | null | undefined,
  contentType: string,
): string {
  const fromHeader = filenameFromContentDisposition(contentDisposition);
  const raw = fromHeader ?? lastPathSegment(url) ?? "document";
  const cleaned = sanitizeSegment(raw) || "document";

  if (hasExtension(cleaned)) {
    return cleaned;
  }
  const ext = extensionForContentType(contentType);
  return ext ? `${cleaned}.${ext}` : cleaned;
}

/**
 * Resolve the vault-relative destination. An explicit path from the agent wins
 * (validated by the caller); otherwise the derived filename goes into
 * `defaultFolder`.
 */
export function resolveDownloadPath(
  explicitPath: string | undefined,
  defaultFolder: string,
  derivedFilename: string,
): string {
  if (explicitPath && explicitPath.trim()) {
    const normalized = normalizeVaultPath(explicitPath.trim());
    // A folder-only path (trailing slash) still needs the derived filename.
    return normalized.endsWith("/") ? joinVaultPath(normalized, derivedFilename) : normalized;
  }
  return joinVaultPath(normalizeVaultPath(defaultFolder), derivedFilename);
}

export function validateDownloadPath(path: string): { ok: true } | { ok: false; reason: string } {
  if (!path) {
    return { ok: false, reason: "invalid-path" };
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment === ".." || segment === ".")) {
    return { ok: false, reason: "invalid-path" };
  }
  if (segments[segments.length - 1] === "") {
    return { ok: false, reason: "invalid-path" };
  }
  if (path === ".ixplorer" || path.startsWith(".ixplorer/")) {
    return { ok: false, reason: "forbidden-path" };
  }
  return { ok: true };
}

export function folderOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index > 0 ? path.slice(0, index) : "";
}

// --- internals -------------------------------------------------------------

function joinVaultPath(folder: string, filename: string): string {
  const trimmed = folder.replace(/\/+$/, "");
  return trimmed ? `${trimmed}/${filename}` : filename;
}

function filenameFromContentDisposition(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const star = value.match(/filename\*=(?:UTF-8'')?([^;]+)/i)?.[1];
  if (star) {
    try {
      return decodeURIComponent(star.trim().replace(/^"|"$/g, ""));
    } catch {
      // fall through to the plain form
    }
  }
  const plain = value.match(/filename="?([^";]+)"?/i)?.[1];
  return plain?.trim();
}

function lastPathSegment(url: string): string | undefined {
  try {
    const { pathname } = new URL(url);
    const decoded = decodeURIComponent(pathname);
    const segment = decoded.split("/").filter(Boolean).pop();
    return segment || undefined;
  } catch {
    return undefined;
  }
}

function sanitizeSegment(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 200);
}

/**
 * Whether the name already carries a *plausible* file extension. A trailing token
 * that is all digits (e.g. arXiv ids like `2301.12345`) or unusually long is not a
 * real extension, so we let the content-type supply one instead of trusting the URL.
 */
function hasExtension(name: string): boolean {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot >= name.length - 1) {
    return false;
  }
  const ext = name.slice(dot + 1);
  return /^[A-Za-z0-9]{1,8}$/.test(ext) && /[A-Za-z]/.test(ext);
}
