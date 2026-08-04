import { describe, expect, it } from "vitest";

import { listSourceModules, reachableModules } from "../helpers/moduleGraph";

const PLUGIN_ENTRY_POINT = "src/apps/obsidian/main.ts";

const MODULES_REACHED_ONLY_BY_TESTS = ["src/apps/obsidian/pluginMetadata.ts"];

describe("module reachability", () => {
  const modules = listSourceModules();
  const curatedBarrels = modules.filter((module) => module.endsWith("/index.ts"));
  const reachable = reachableModules([PLUGIN_ENTRY_POINT, ...curatedBarrels]);

  it("resolves the plugin entry point and its curated barrels", () => {
    expect(modules).toContain(PLUGIN_ENTRY_POINT);
    expect(curatedBarrels.length).toBeGreaterThan(5);
    expect(reachable.size).toBeGreaterThan(modules.length / 2);
  });

  it("keeps every module reachable from an entry point", () => {
    const unreachable = modules
      .filter((module) => !reachable.has(module))
      .filter((module) => !MODULES_REACHED_ONLY_BY_TESTS.includes(module));

    expect(unreachable).toEqual([]);
  });

  it("keeps the allowlist honest", () => {
    expect(MODULES_REACHED_ONLY_BY_TESTS.every((module) => modules.includes(module))).toBe(true);
    expect(MODULES_REACHED_ONLY_BY_TESTS.length).toBeLessThanOrEqual(3);
  });
});
