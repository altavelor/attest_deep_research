import manifest from "../manifest.json";
import packageJson from "../package.json";
import versions from "../versions.json";
import {
  MIN_OBSIDIAN_VERSION,
  PLUGIN_DESCRIPTION,
  PLUGIN_ID,
  PLUGIN_NAME,
  PLUGIN_VERSION,
} from "@apps/obsidian/pluginMetadata";

const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

describe("plugin metadata", () => {
  it("re-exports the manifest as the single source of truth", () => {
    expect(PLUGIN_ID).toBe(manifest.id);
    expect(PLUGIN_NAME).toBe(manifest.name);
    expect(PLUGIN_VERSION).toBe(manifest.version);
    expect(MIN_OBSIDIAN_VERSION).toBe(manifest.minAppVersion);
    expect(PLUGIN_DESCRIPTION).toBe(manifest.description);
  });

  it("declares a manifest Obsidian will accept", () => {
    expect(manifest.id).toMatch(/^[a-z0-9-]+$/);
    expect(manifest.name.trim()).not.toBe("");
    expect(manifest.description.trim()).not.toBe("");
    expect(manifest.version).toMatch(SEMVER);
    expect(manifest.minAppVersion).toMatch(SEMVER);
    expect(manifest.isDesktopOnly).toBe(false);
    expect(manifest.authorUrl).toBe("https://github.com/altavelor");
  });

  it("keeps package.json and versions.json in sync with the manifest", () => {
    expect(packageJson.version).toBe(manifest.version);
    expect(versions[manifest.version as keyof typeof versions]).toBe(manifest.minAppVersion);
  });
});
