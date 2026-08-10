/**
 * Decodes untrusted base64 text into bytes, tolerating the line breaks and
 * indentation embedded documents use. Returns undefined when the payload is not
 * decodable rather than throwing.
 */
export function decodeBase64(value: string): Uint8Array | undefined {
  const compact = value.replace(/\s+/g, "");

  if (!compact) {
    return undefined;
  }

  let binary: string;
  try {
    binary = atob(compact);
  } catch {
    return undefined;
  }

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index) & 0xff;
  }

  return bytes;
}
