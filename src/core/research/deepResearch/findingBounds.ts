import { MAX_BRANCH_FINDING_BYTES, MAX_BRANCH_FINDING_CHARS } from "./limits";

/** Returns the UTF-8 size of a text as it is stored: its JSON string encoding. */
export function encodedFindingBytes(text: string): number {
  return new TextEncoder().encode(JSON.stringify(text)).length;
}

/** Tells whether a stored finding text is within both its character and its encoded-size bound. */
export function isFindingText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_BRANCH_FINDING_CHARS &&
    encodedFindingBytes(value) <= MAX_BRANCH_FINDING_BYTES
  );
}

/**
 * Cuts a finding to its character bound and then to the longest prefix whose stored encoding fits
 * the byte bound, without splitting a surrogate pair.
 */
export function boundFindingText(text: string): string {
  let bounded = text.slice(0, MAX_BRANCH_FINDING_CHARS);
  if (encodedFindingBytes(bounded) <= MAX_BRANCH_FINDING_BYTES) return bounded;
  let low = 0;
  let high = bounded.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (encodedFindingBytes(bounded.slice(0, middle)) <= MAX_BRANCH_FINDING_BYTES) low = middle;
    else high = middle - 1;
  }
  bounded = bounded.slice(0, low);
  const last = bounded.charCodeAt(bounded.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? bounded.slice(0, -1) : bounded;
}
