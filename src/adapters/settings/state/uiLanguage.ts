import { isLocalePreference } from "@core/i18n";
import type { LocalePreference } from "@core/i18n";

export const DEFAULT_UI_LANGUAGE: LocalePreference = "auto";

/**
 * Reads the stored interface-language preference. Installations saved before
 * the setting existed, and files carrying an unknown or malformed value, fall
 * back to `auto`.
 */
export function readUiLanguage(savedSettings: unknown): LocalePreference {
  if (typeof savedSettings !== "object" || savedSettings === null || Array.isArray(savedSettings)) {
    return DEFAULT_UI_LANGUAGE;
  }

  const value = (savedSettings as { uiLanguage?: unknown }).uiLanguage;
  return isLocalePreference(value) ? value : DEFAULT_UI_LANGUAGE;
}
