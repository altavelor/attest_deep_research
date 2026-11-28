/**
 * Fingerprints the whole text of a page, so a page fetched again is recognised as unchanged only
 * when every character matches. The hash is for cache consistency, not for security.
 */
export function pageFingerprint(text: string): string {
  let first = 0xdeadbeef ^ text.length;
  let second = 0x41c6ce57 ^ text.length;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 2654435761);
    second = Math.imul(second ^ code, 1597334677);
  }
  first =
    Math.imul(first ^ (first >>> 16), 2246822507) ^ Math.imul(second ^ (second >>> 13), 3266489909);
  second =
    Math.imul(second ^ (second >>> 16), 2246822507) ^ Math.imul(first ^ (first >>> 13), 3266489909);
  return `${text.length}:${(first >>> 0).toString(16)}${(second >>> 0).toString(16)}`;
}
