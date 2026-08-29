// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS, cloneIndexProfile, DEFAULT_INDEX_PROFILE } from "@adapters/settings";
import type { AttestSettings } from "@adapters/settings";
import { createTranslator } from "@adapters/i18n";
import { NewChatDefaultsSection } from "@apps/obsidian/ui/settings/NewChatDefaultsSection";
import {
  installObsidianDomHelpers,
  resetDom,
  restoreDomTimers,
  useDomFakeTimers,
} from "../helpers/domHarness";

const t = createTranslator("en").t;

function settings(): AttestSettings {
  return {
    ...DEFAULT_SETTINGS,
    indexProfiles: [cloneIndexProfile(DEFAULT_INDEX_PROFILE)],
  };
}

describe("NewChatDefaultsSection", () => {
  beforeEach(() => {
    installObsidianDomHelpers();
    useDomFakeTimers();
  });

  afterEach(() => {
    restoreDomTimers();
    resetDom();
    vi.restoreAllMocks();
  });

  it("persists source and active-file selections without redisplaying the form", async () => {
    const current = settings();
    const saveSettings = vi.fn(async () => {});
    const requestRedisplay = vi.fn();
    const container = document.createElement("div");
    new NewChatDefaultsSection({ t, settings: current, saveSettings, requestRedisplay }).render(
      container,
    );
    const source = Array.from(container.querySelectorAll<HTMLSelectElement>("select")).find(
      (select) => Array.from(select.options).some((option) => option.value === "indexAndWeb"),
    );
    const activeFile = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    const nextActiveFileValue = !current.newChatDefaults.includeActiveFileContext;

    expect(source).toBeDefined();
    expect(activeFile).not.toBeNull();
    source!.value = "webOnly";
    source!.dispatchEvent(new Event("change"));
    activeFile!.click();

    await vi.waitFor(() => {
      expect(current.newChatDefaults.searchMode).toBe("webOnly");
      expect(current.newChatDefaults.includeActiveFileContext).toBe(nextActiveFileValue);
      expect(saveSettings).toHaveBeenCalledTimes(2);
    });
    expect(requestRedisplay).not.toHaveBeenCalled();
  });
});
