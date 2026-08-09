import { describe, expect, it } from "vitest";

import { SUPPORTED_LOCALES } from "@core/i18n";
import { LOCALE_MESSAGES, REFERENCE_MESSAGES } from "@adapters/i18n";

const PLACEHOLDER_PATTERN = /\{([A-Za-z0-9_]+)\}/g;

function placeholders(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1]).sort();
}

const referenceKeys = Object.keys(REFERENCE_MESSAGES).sort();

describe("locale dictionaries", () => {
  it("ships a dictionary for every supported locale", () => {
    expect(Object.keys(LOCALE_MESSAGES).sort()).toEqual([...SUPPORTED_LOCALES].sort());
  });

  it("declares a non-trivial set of message keys", () => {
    expect(referenceKeys.length).toBeGreaterThan(50);
  });

  it.each([...SUPPORTED_LOCALES])("covers exactly the English keys in %s", (locale) => {
    expect(Object.keys(LOCALE_MESSAGES[locale]).sort()).toEqual(referenceKeys);
  });

  it.each([...SUPPORTED_LOCALES])("has no blank message in %s", (locale) => {
    const blank = Object.entries(LOCALE_MESSAGES[locale])
      .filter(([, value]) => typeof value !== "string" || value.trim().length === 0)
      .map(([key]) => key);

    expect(blank).toEqual([]);
  });

  it.each([...SUPPORTED_LOCALES])("keeps the English placeholders in %s", (locale) => {
    const mismatched = referenceKeys.filter((key) => {
      const translated = LOCALE_MESSAGES[locale][key as keyof typeof REFERENCE_MESSAGES];
      return (
        translated !== undefined &&
        placeholders(translated).join(",") !==
          placeholders(REFERENCE_MESSAGES[key as keyof typeof REFERENCE_MESSAGES]).join(",")
      );
    });

    expect(mismatched).toEqual([]);
  });

  it.each([...SUPPORTED_LOCALES].filter((locale) => locale !== "en"))(
    "actually translates most of the interface in %s",
    (locale) => {
      const untranslated = referenceKeys.filter(
        (key) =>
          LOCALE_MESSAGES[locale][key as keyof typeof REFERENCE_MESSAGES] ===
          REFERENCE_MESSAGES[key as keyof typeof REFERENCE_MESSAGES],
      );

      expect(untranslated.length).toBeLessThan(referenceKeys.length / 4);
    },
  );
});
