/**
 * Reads the display language Obsidian is running with. Obsidian persists the
 * chosen language under the `language` key of local storage and leaves it empty
 * for English; the browser language is the last resort.
 */
export function readObsidianLanguage(): string | undefined {
  const stored = readStoredLanguage();
  if (stored) {
    return stored;
  }

  const documentLanguage = globalThis.document?.documentElement?.lang;
  if (typeof documentLanguage === "string" && documentLanguage.trim()) {
    return documentLanguage;
  }

  const navigatorLanguage = globalThis.navigator?.language;
  return typeof navigatorLanguage === "string" && navigatorLanguage.trim()
    ? navigatorLanguage
    : undefined;
}

function readStoredLanguage(): string | undefined {
  try {
    const value = globalThis.localStorage?.getItem("language");
    return typeof value === "string" && value.trim() ? value : undefined;
  } catch {
    return undefined;
  }
}
