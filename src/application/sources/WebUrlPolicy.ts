export type WebUrlValidationResult = { ok: true; url: string } | { ok: false; reason: string };

export function validatePublicWebUrl(value: string): WebUrlValidationResult {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: "invalid-url" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "unsupported-protocol" };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "credentials-not-allowed" };
  }

  const hostname = normalizedHostname(url.hostname);
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) {
    return { ok: false, reason: "local-hostname" };
  }
  if (isUnsafeIpLiteral(hostname)) {
    return { ok: false, reason: "non-public-address" };
  }

  url.hash = "";
  url.protocol = url.protocol.toLowerCase();
  url.hostname = hostname;
  if (
    (url.protocol === "https:" && url.port === "443") ||
    (url.protocol === "http:" && url.port === "80")
  ) {
    url.port = "";
  }
  return { ok: true, url: url.toString() };
}

function normalizedHostname(hostname: string): string {
  return hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "")
    .toLowerCase();
}

function isUnsafeIpLiteral(hostname: string): boolean {
  if (hostname.includes(":")) {
    return isUnsafeIpv6(hostname);
  }

  const octets = hostname.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }

  const [a, b, c] = octets as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function isUnsafeIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (normalized === "::" || normalized === "::1") {
    return true;
  }
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) {
    return true;
  }
  const firstGroup = Number.parseInt(normalized.split(":", 1)[0] || "0", 16);
  if (firstGroup >= 0xfe80 && firstGroup <= 0xfebf) {
    return true;
  }
  if (firstGroup >= 0xff00 && firstGroup <= 0xffff) {
    return true;
  }
  if (normalized.startsWith("2001:db8:")) {
    return true;
  }
  const mappedIpv4 = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedIpv4) {
    return isUnsafeIpLiteral(mappedIpv4);
  }
  const mappedHex = normalized.match(/::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const high = Number.parseInt(mappedHex[1] ?? "0", 16);
    const low = Number.parseInt(mappedHex[2] ?? "0", 16);
    return isUnsafeIpLiteral(`${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`);
  }
  return false;
}
