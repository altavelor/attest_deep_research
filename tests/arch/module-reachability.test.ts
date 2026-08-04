import { describe, expect, it } from "vitest";

import { listSourceModules, reachableModules } from "../helpers/moduleGraph";

const ENTRY_POINTS = ["src/apps/obsidian/main.ts"];

const MODULES_REACHED_ONLY_BY_TESTS = ["src/apps/obsidian/pluginMetadata.ts"];

describe("module reachability", () => {
  const modules = listSourceModules();
  const reachable = reachableModules(ENTRY_POINTS);

  it("resolves every declared entry point", () => {
    expect(ENTRY_POINTS.filter((entry) => !modules.includes(entry))).toEqual([]);
    expect(ENTRY_POINTS.length).toBeLessThanOrEqual(3);
    expect(reachable.size).toBeGreaterThan(modules.length / 2);
  });

  it("keeps every module reachable from an entry point", () => {
    const unreachable = modules
      .filter((module) => !reachable.has(module))
      .filter((module) => !MODULES_REACHED_ONLY_BY_TESTS.includes(module));

    expect(unreachable).toEqual([]);
  });

  it("keeps every curated barrel reachable from an entry point", () => {
    const barrels = modules.filter((module) => module.endsWith("/index.ts"));

    expect(barrels.length).toBeGreaterThan(5);
    expect(barrels.filter((barrel) => !reachable.has(barrel))).toEqual([]);
  });

  it("keeps the allowlist honest", () => {
    expect(MODULES_REACHED_ONLY_BY_TESTS.every((module) => modules.includes(module))).toBe(true);
    expect(MODULES_REACHED_ONLY_BY_TESTS.length).toBeLessThanOrEqual(3);
  });
});
