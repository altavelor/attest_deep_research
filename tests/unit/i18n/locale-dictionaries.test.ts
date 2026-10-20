import { describe, expect, it } from "vitest";

import { SUPPORTED_LOCALES } from "@core/i18n";
import { LOCALE_MESSAGES, REFERENCE_MESSAGES } from "@adapters/i18n";

const PLACEHOLDER_PATTERN = /\{([A-Za-z0-9_]+)\}/g;

function placeholders(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1]).sort();
}

const referenceKeys = Object.keys(REFERENCE_MESSAGES).sort();

describe("locale dictionaries", () => {
  it("ships a dictionary for every supported locale over a non-trivial key set", () => {
    expect(Object.keys(LOCALE_MESSAGES).sort()).toEqual([...SUPPORTED_LOCALES].sort());
    expect(referenceKeys.length).toBeGreaterThan(50);
  });

  it("covers exactly the English keys in every locale", () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(LOCALE_MESSAGES[locale]).sort(), locale).toEqual(referenceKeys);
    }
  });

  it("has no blank message in any locale", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const blank = Object.entries(LOCALE_MESSAGES[locale])
        .filter(([, value]) => typeof value !== "string" || value.trim().length === 0)
        .map(([key]) => key);

      expect(blank, locale).toEqual([]);
    }
  });

  it("keeps the English placeholders in every locale", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const mismatched = referenceKeys.filter((key) => {
        const translated = LOCALE_MESSAGES[locale][key as keyof typeof REFERENCE_MESSAGES];
        return (
          translated !== undefined &&
          placeholders(translated).join(",") !==
            placeholders(REFERENCE_MESSAGES[key as keyof typeof REFERENCE_MESSAGES]).join(",")
        );
      });

      expect(mismatched, locale).toEqual([]);
    }
  });

  it("actually translates most of the interface in every non-English locale", () => {
    for (const locale of SUPPORTED_LOCALES.filter((candidate) => candidate !== "en")) {
      const untranslated = referenceKeys.filter(
        (key) =>
          LOCALE_MESSAGES[locale][key as keyof typeof REFERENCE_MESSAGES] ===
          REFERENCE_MESSAGES[key as keyof typeof REFERENCE_MESSAGES],
      );

      expect(untranslated.length, locale).toBeLessThan(referenceKeys.length / 4);
    }
  });
});
