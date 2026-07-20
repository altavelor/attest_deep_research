import manifest from "@manifest";

// manifest.json is the single source of truth for plugin identity: Obsidian
// reads it directly, and the release workflow validates the git tag against it.
// Everything else in the project derives from these re-exports rather than
// restating the values, so a rename cannot drift between the two.
export const PLUGIN_ID = manifest.id;
export const PLUGIN_NAME = manifest.name;
export const PLUGIN_VERSION = manifest.version;
export const MIN_OBSIDIAN_VERSION = manifest.minAppVersion;
export const PLUGIN_DESCRIPTION = manifest.description;
export const PLUGIN_AUTHOR = manifest.author;
export const PLUGIN_AUTHOR_URL = manifest.authorUrl;
