// Core retrieval: search tokenization (stage 2). Pure, platform-neutral.

export function tokenizeForSearch(value: string, options: { minLength?: number } = {}): string[] {
  const minLength = options.minLength ?? 1;

  return value
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= minLength);
}

export function tokenSetForSearch(
  value: string,
  options: { minLength?: number } = {},
): Set<string> {
  return new Set(tokenizeForSearch(value, options));
}
