import { describe, expect, it, vi } from "vitest";

const { createWebSearchProvider } = vi.hoisted(() => ({
  createWebSearchProvider: vi.fn(),
}));

vi.mock("@apps/obsidian/composition/webSearchFactory", () => ({ createWebSearchProvider }));

import { DEFAULT_SETTINGS } from "@adapters/settings";
import type { CompositionContext } from "@apps/obsidian/composition/factories";
import { createSearchProvider } from "@apps/obsidian/composition/factories";

describe("composition factories", () => {
  it("passes settings and shared infrastructure into the web-search factory", () => {
    const settings = { ...DEFAULT_SETTINGS };
    const logger = { logError: vi.fn() };
    const health = { getIssue: vi.fn() };
    const provider = { search: vi.fn() };
    const intentClassifier = { classify: vi.fn() };
    createWebSearchProvider.mockReturnValue(provider);
    const ctx = {
      getSettings: () => settings,
      logger,
      webSourceHealth: health,
    } as unknown as CompositionContext;

    expect(createSearchProvider(ctx, intentClassifier)).toBe(provider);
    expect(createWebSearchProvider).toHaveBeenCalledWith({
      settings,
      logger,
      health,
      intentClassifier,
    });
  });
});
