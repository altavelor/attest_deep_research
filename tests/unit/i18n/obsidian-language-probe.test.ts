// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import { readObsidianLanguage } from "@adapters/obsidian/ObsidianLanguageProbe";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.documentElement.removeAttribute("lang");
});

describe("Obsidian language probe", () => {
  it("prefers the language Obsidian stored in local storage", () => {
    window.localStorage.setItem("language", "ru");
    document.documentElement.lang = "de";

    expect(readObsidianLanguage()).toBe("ru");
  });

  it("falls back to the document language when local storage is empty", () => {
    window.localStorage.setItem("language", "   ");
    document.documentElement.lang = "fr";

    expect(readObsidianLanguage()).toBe("fr");
  });

  it("survives a local storage that throws on access", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("access denied");
    });
    document.documentElement.lang = "es";

    expect(readObsidianLanguage()).toBe("es");
  });

  it("reports no language when neither storage nor document declares one", () => {
    vi.spyOn(window.navigator, "language", "get").mockReturnValue("");

    expect(readObsidianLanguage()).toBeUndefined();
  });
});
