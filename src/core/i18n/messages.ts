export type MessageParams = Readonly<Record<string, string | number | boolean>>;

export type MessageDictionary = Readonly<Record<string, string>>;

export type PartialMessageDictionary = Readonly<Record<string, string | undefined>>;

export interface MessageResolution {
  dictionary: PartialMessageDictionary;
  fallbackDictionary: MessageDictionary;
  key: string;
  params?: MessageParams;
}

const PLACEHOLDER_PATTERN = /\{([A-Za-z0-9_]+)\}/g;

/**
 * Resolves a message by key, preferring the active dictionary and falling back
 * to the reference dictionary when the key is missing or blank. An unknown key
 * resolves to the key itself so a gap never renders as an empty string.
 */
export function resolveMessage(resolution: MessageResolution): string {
  const template = selectTemplate(resolution);
  return applyParams(template, resolution.params);
}

/**
 * Substitutes `{name}` placeholders in a single pass, so values that themselves
 * contain braces are never re-expanded. Placeholders without a matching
 * parameter are left untouched.
 */
export function applyParams(template: string, params?: MessageParams): string {
  if (!params) {
    return template;
  }

  return template.replace(PLACEHOLDER_PATTERN, (placeholder, name: string) => {
    const value = params[name];
    return value === undefined ? placeholder : String(value);
  });
}

function selectTemplate(resolution: MessageResolution): string {
  const preferred = resolution.dictionary[resolution.key];
  if (typeof preferred === "string" && preferred.length > 0) {
    return preferred;
  }

  const fallback = resolution.fallbackDictionary[resolution.key];
  if (typeof fallback === "string" && fallback.length > 0) {
    return fallback;
  }

  return resolution.key;
}
