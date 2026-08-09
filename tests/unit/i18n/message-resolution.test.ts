import { describe, expect, it } from "vitest";

import { applyParams, resolveMessage } from "@core/i18n";
import { createTranslator } from "@adapters/i18n";

const fallbackDictionary = {
  greeting: "Hello, {name}!",
  counted: "{done} of {total} files",
  plain: "Plain text",
};

describe("message resolution", () => {
  it("substitutes named parameters", () => {
    expect(
      resolveMessage({
        dictionary: { greeting: "Привет, {name}!" },
        fallbackDictionary,
        key: "greeting",
        params: { name: "Ilya" },
      }),
    ).toBe("Привет, Ilya!");
  });

  it("substitutes numeric parameters and leaves unknown placeholders alone", () => {
    expect(
      resolveMessage({
        dictionary: {},
        fallbackDictionary,
        key: "counted",
        params: { done: 3 },
      }),
    ).toBe("3 of {total} files");
  });

  it("falls back to English when the locale omits or blanks the key", () => {
    expect(
      resolveMessage({
        dictionary: { greeting: undefined },
        fallbackDictionary,
        key: "greeting",
        params: { name: "Ilya" },
      }),
    ).toBe("Hello, Ilya!");
    expect(resolveMessage({ dictionary: { plain: "" }, fallbackDictionary, key: "plain" })).toBe(
      "Plain text",
    );
  });

  it("returns the key itself when no dictionary defines it", () => {
    expect(resolveMessage({ dictionary: {}, fallbackDictionary, key: "absent.key" })).toBe(
      "absent.key",
    );
  });

  it("never re-expands braces that arrive inside a parameter value", () => {
    expect(applyParams("Hello, {name}!", { name: "{name}" })).toBe("Hello, {name}!");
    expect(applyParams("{a}{b}", { a: "{b}", b: "x" })).toBe("{b}x");
  });

  it("leaves the template untouched when no parameters are supplied", () => {
    expect(applyParams("Hello, {name}!")).toBe("Hello, {name}!");
  });
});

describe("translator", () => {
  it("reports the locale and its writing direction", () => {
    expect(createTranslator("ar").direction).toBe("rtl");
    expect(createTranslator("ru").direction).toBe("ltr");
    expect(createTranslator("ru").locale).toBe("ru");
  });

  it("returns the localized string for a translated key", () => {
    expect(createTranslator("ru").t("common.cancel")).toBe("Отмена");
    expect(createTranslator("en").t("common.cancel")).toBe("Cancel");
  });

  it("falls back to English text rather than an empty string for a missing key", () => {
    const translator = createTranslator("ru");
    const missing = translator.translate("definitely.not.a.key");

    expect(missing).toBe("definitely.not.a.key");
    expect(missing).not.toBe("");
  });
});
