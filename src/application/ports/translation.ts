import type { LocaleCode, MessageParams, TextDirection } from "@core/i18n";

/**
 * Supplies localized user-facing text to use cases and UI. Implementations own
 * the concrete dictionaries; consumers only see the effective locale, its
 * writing direction, and a key-based lookup that never throws.
 */
export interface TranslationPort {
  readonly locale: LocaleCode;
  readonly direction: TextDirection;
  translate(key: string, params?: MessageParams): string;
}
