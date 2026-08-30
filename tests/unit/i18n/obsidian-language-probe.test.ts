// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import * as Obsidian from "obsidian";

import { readObsidianLanguage } from "@adapters/obsidian/ObsidianLanguageProbe";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Obsidian language probe", () => {
  it("reads the language through the supported Obsidian API", () => {
    vi.spyOn(Obsidian, "getLanguage").mockReturnValue("ru");

    expect(readObsidianLanguage()).toBe("ru");
  });

  it("reports no language when Obsidian returns an empty value", () => {
    vi.spyOn(Obsidian, "getLanguage").mockReturnValue("   ");

    expect(readObsidianLanguage()).toBeUndefined();
  });
});
