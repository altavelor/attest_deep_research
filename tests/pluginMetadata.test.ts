import manifest from "../manifest.json";
import {
  MIN_OBSIDIAN_VERSION,
  PLUGIN_DESCRIPTION,
  PLUGIN_ID,
  PLUGIN_NAME,
  PLUGIN_VERSION,
} from "../src/apps/obsidian/pluginMetadata";

describe("plugin metadata", () => {
  it("matches the Obsidian manifest", () => {
    expect(manifest.id).toBe(PLUGIN_ID);
    expect(manifest.name).toBe(PLUGIN_NAME);
    expect(manifest.version).toBe(PLUGIN_VERSION);
    expect(manifest.minAppVersion).toBe(MIN_OBSIDIAN_VERSION);
    expect(manifest.description).toBe(PLUGIN_DESCRIPTION);
    expect(manifest.isDesktopOnly).toBe(true);
  });
});
