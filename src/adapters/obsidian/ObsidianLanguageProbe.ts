import { getLanguage } from "obsidian";

/** Reads the display language through Obsidian's supported API. */
export function readObsidianLanguage(): string | undefined {
  const language = getLanguage();
  return language.trim() ? language : undefined;
}
