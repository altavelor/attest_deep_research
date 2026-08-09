export const SUPPORTED_LOCALES = ["en", "zh-CN", "es", "ar", "de", "fr", "ru"] as const;

export type LocaleCode = (typeof SUPPORTED_LOCALES)[number];

export type LocalePreference = LocaleCode | "auto";

export type TextDirection = "ltr" | "rtl";

export const DEFAULT_LOCALE: LocaleCode = "en";

export const LOCALE_NATIVE_NAMES: Readonly<Record<LocaleCode, string>> = {
  en: "English",
  "zh-CN": "中文（简体）",
  es: "Español",
  ar: "العربية",
  de: "Deutsch",
  fr: "Français",
  ru: "Русский",
};

const RTL_LOCALES: ReadonlySet<string> = new Set<LocaleCode>(["ar"]);

const HOST_LANGUAGE_ALIASES: Readonly<Record<string, LocaleCode>> = {
  zh: "zh-CN",
  "zh-cn": "zh-CN",
  "zh-hans": "zh-CN",
  "zh-sg": "zh-CN",
};

export function isLocaleCode(value: unknown): value is LocaleCode {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function isLocalePreference(value: unknown): value is LocalePreference {
  return value === "auto" || isLocaleCode(value);
}

export function localeDirection(locale: LocaleCode): TextDirection {
  return RTL_LOCALES.has(locale) ? "rtl" : "ltr";
}

/**
 * Maps a host application language tag onto a supported locale. Unknown,
 * malformed, or unsupported tags resolve to `undefined` so the caller can fall
 * back to the default locale.
 */
export function matchHostLanguage(hostLanguage: unknown): LocaleCode | undefined {
  if (typeof hostLanguage !== "string") {
    return undefined;
  }

  const normalized = hostLanguage.trim().replace(/_/g, "-").toLowerCase();
  if (!normalized) {
    return undefined;
  }

  const alias = HOST_LANGUAGE_ALIASES[normalized];
  if (alias) {
    return alias;
  }

  const exact = SUPPORTED_LOCALES.find((locale) => locale.toLowerCase() === normalized);
  if (exact) {
    return exact;
  }

  const base = normalized.split("-")[0];
  const baseAlias = HOST_LANGUAGE_ALIASES[base];
  if (baseAlias) {
    return baseAlias;
  }

  return SUPPORTED_LOCALES.find((locale) => locale.toLowerCase().split("-")[0] === base);
}

/**
 * Resolves the effective locale from the stored preference and the host
 * application language. `auto` follows the host language and degrades to the
 * default locale when the host language is unsupported.
 */
export function resolveLocale(preference: unknown, hostLanguage?: unknown): LocaleCode {
  if (isLocaleCode(preference)) {
    return preference;
  }

  if (preference === "auto") {
    return matchHostLanguage(hostLanguage) ?? DEFAULT_LOCALE;
  }

  return DEFAULT_LOCALE;
}
