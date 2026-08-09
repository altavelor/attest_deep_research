import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS, readSettings, readUiLanguage } from "@adapters/settings";

function savedSettings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...DEFAULT_SETTINGS,
    indexProfiles: DEFAULT_SETTINGS.indexProfiles.map((profile) => ({ ...profile })),
    ...overrides,
  };
}

describe("interface-language setting", () => {
  it("defaults to auto on a clean install", () => {
    expect(DEFAULT_SETTINGS.uiLanguage).toBe("auto");
    expect(readSettings(undefined).uiLanguage).toBe("auto");
  });

  it("migrates a configuration saved before the setting existed", () => {
    const legacy = savedSettings();
    delete legacy.uiLanguage;

    const settings = readSettings(legacy);

    expect(settings.uiLanguage).toBe("auto");
    expect(settings.debugMode).toBe(DEFAULT_SETTINGS.debugMode);
    expect(settings.graphContextDepth).toBe(DEFAULT_SETTINGS.graphContextDepth);
  });

  it("restores a stored language and leaves neighbouring settings intact", () => {
    const settings = readSettings(savedSettings({ uiLanguage: "ru", debugMode: true }));

    expect(settings.uiLanguage).toBe("ru");
    expect(settings.debugMode).toBe(true);
  });

  it("degrades unknown or malformed stored values to auto", () => {
    expect(readSettings(savedSettings({ uiLanguage: "hi" })).uiLanguage).toBe("auto");
    expect(readSettings(savedSettings({ uiLanguage: 7 })).uiLanguage).toBe("auto");
    expect(readSettings(savedSettings({ uiLanguage: null })).uiLanguage).toBe("auto");
    expect(readSettings(savedSettings({ uiLanguage: { code: "ru" } })).uiLanguage).toBe("auto");
  });

  it("survives a settings file that is not an object at all", () => {
    expect(readUiLanguage(null)).toBe("auto");
    expect(readUiLanguage("ru")).toBe("auto");
    expect(readUiLanguage([{ uiLanguage: "ru" }])).toBe("auto");
  });
});
