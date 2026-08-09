import { normalizeVaultPath, vaultPathMatchesGlob } from "@shared";
import { DEFAULT_LOCALE } from "@core/i18n";
import type { LocaleCode } from "@core/i18n";

export function normalizePickerPath(path: string): string {
  return normalizeVaultPath(path).replace(/\/+$/, "");
}

export function isSupportedIndexFile(path: string): boolean {
  const lower = path.toLocaleLowerCase();
  return (
    lower.endsWith(".md") ||
    lower.endsWith(".txt") ||
    lower.endsWith(".pdf") ||
    lower.endsWith(".docx") ||
    lower.endsWith(".epub") ||
    lower.endsWith(".fb2")
  );
}

export function isHiddenOrIgnoredPath(path: string, ignoredGlobs: string[]): boolean {
  const normalized = normalizePickerPath(path);
  if (!normalized) {
    return false;
  }

  if (normalized.split("/").some((segment) => segment.startsWith("."))) {
    return true;
  }

  return ignoredGlobs.some((glob) => vaultPathMatchesGlob(normalized, glob));
}

export function formatReportTimestamp(value: string, locale: LocaleCode = DEFAULT_LOCALE): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "medium" }).format(date);
}
