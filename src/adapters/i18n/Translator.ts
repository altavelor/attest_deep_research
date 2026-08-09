import type { LocaleCode, MessageParams, TextDirection } from "@core/i18n";
import { DEFAULT_LOCALE, localeDirection, resolveMessage } from "@core/i18n";
import { LOCALE_MESSAGES, REFERENCE_MESSAGES } from "./locales";
import type { MessageKey, Translate, UiTranslator } from "./messages";

/**
 * Binds a locale to its dictionary. Lookups fall back to the English reference
 * dictionary for keys the locale does not define, and to the key itself when
 * neither dictionary defines it.
 */
export function createTranslator(locale: LocaleCode): UiTranslator {
  const dictionary = LOCALE_MESSAGES[locale] ?? LOCALE_MESSAGES[DEFAULT_LOCALE];
  const effectiveLocale: LocaleCode = LOCALE_MESSAGES[locale] ? locale : DEFAULT_LOCALE;
  const direction: TextDirection = localeDirection(effectiveLocale);
  const t: Translate = (key: MessageKey, params?: MessageParams) =>
    resolveMessage({
      dictionary,
      fallbackDictionary: REFERENCE_MESSAGES,
      key,
      params,
    });

  return {
    locale: effectiveLocale,
    direction,
    t,
    translate: (key: string, params?: MessageParams) => t(key as MessageKey, params),
  };
}
