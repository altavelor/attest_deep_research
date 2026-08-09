import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  isLocaleCode,
  isLocalePreference,
  localeDirection,
  matchHostLanguage,
  resolveLocale,
} from "@core/i18n";

describe("supported locales", () => {
  it("offers the seven languages the settings dropdown exposes", () => {
    expect([...SUPPORTED_LOCALES]).toEqual(["en", "zh-CN", "es", "ar", "de", "fr", "ru"]);
    expect(DEFAULT_LOCALE).toBe("en");
  });

  it("recognises locale codes and the auto preference", () => {
    expect(isLocaleCode("ru")).toBe(true);
    expect(isLocaleCode("auto")).toBe(false);
    expect(isLocaleCode("hi")).toBe(false);
    expect(isLocaleCode(42)).toBe(false);
    expect(isLocalePreference("auto")).toBe(true);
    expect(isLocalePreference("ru")).toBe(true);
    expect(isLocalePreference("klingon")).toBe(false);
    expect(isLocalePreference(null)).toBe(false);
  });

  it("marks Arabic as the only right-to-left locale", () => {
    expect(localeDirection("ar")).toBe("rtl");
    for (const locale of SUPPORTED_LOCALES.filter((code) => code !== "ar")) {
      expect(localeDirection(locale)).toBe("ltr");
    }
  });
});

describe("host language matching", () => {
  it("maps every Obsidian Chinese tag onto the simplified dictionary", () => {
    expect(matchHostLanguage("zh")).toBe("zh-CN");
    expect(matchHostLanguage("zh-CN")).toBe("zh-CN");
    expect(matchHostLanguage("zh_Hans")).toBe("zh-CN");
    expect(matchHostLanguage("ZH-SG")).toBe("zh-CN");
  });

  it("matches regional tags by their base language", () => {
    expect(matchHostLanguage("de-AT")).toBe("de");
    expect(matchHostLanguage("fr-CA")).toBe("fr");
    expect(matchHostLanguage("en-GB")).toBe("en");
  });

  it("rejects unsupported and malformed tags", () => {
    expect(matchHostLanguage("hi")).toBeUndefined();
    expect(matchHostLanguage("ja-JP")).toBeUndefined();
    expect(matchHostLanguage("")).toBeUndefined();
    expect(matchHostLanguage("   ")).toBeUndefined();
    expect(matchHostLanguage(undefined)).toBeUndefined();
    expect(matchHostLanguage(17)).toBeUndefined();
    expect(matchHostLanguage({ language: "ru" })).toBeUndefined();
  });
});

describe("effective locale resolution", () => {
  it("uses an explicit preference regardless of the host language", () => {
    expect(resolveLocale("ru", "de")).toBe("ru");
    expect(resolveLocale("ar", undefined)).toBe("ar");
  });

  it("follows the host language when the preference is auto", () => {
    expect(resolveLocale("auto", "ru")).toBe("ru");
    expect(resolveLocale("auto", "zh")).toBe("zh-CN");
  });

  it("falls back to English when auto meets an unsupported host language", () => {
    expect(resolveLocale("auto", "hi")).toBe("en");
    expect(resolveLocale("auto", undefined)).toBe("en");
    expect(resolveLocale("auto", "")).toBe("en");
  });

  it("falls back to English for a stored value that is no longer valid", () => {
    expect(resolveLocale("klingon", "ru")).toBe("en");
    expect(resolveLocale(undefined, "ru")).toBe("en");
    expect(resolveLocale(null, "ru")).toBe("en");
  });
});
