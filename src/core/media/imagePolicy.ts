// Pure policy for image eligibility: which encodings may be shown, which URLs
// may be hotlinked, and which vault-relative paths may be resolved. Adapters and
// tools share these rules so provider, page, and document candidates are judged
// identically.

export const ELIGIBLE_IMAGE_FORMATS = ["png", "jpeg", "webp", "gif", "avif"] as const;

export type EligibleImageFormat = (typeof ELIGIBLE_IMAGE_FORMATS)[number];

export const IMAGE_EXTRACTION_LIMITS = {
  /** Candidates collected from a single fetched page or document. */
  candidatesPerSource: 8,
  /** Compressed bytes of a single embedded image. */
  maxEncodedBytes: 8 * 1024 * 1024,
  /** Compressed bytes extracted from one document in a single pass. */
  maxTotalEncodedBytes: 32 * 1024 * 1024,
  /** Decoded pixels; guards against decompression-bomb-like assets. */
  maxPixels: 40_000_000,
  /** Members inspected inside a zip-based container. */
  maxArchiveEntries: 4000,
  /** Smallest edge accepted; filters tracking pixels and spacers. */
  minEdgePixels: 24,
} as const;

const EXTENSION_FORMATS: Record<string, EligibleImageFormat> = {
  png: "png",
  jpg: "jpeg",
  jpeg: "jpeg",
  jfif: "jpeg",
  webp: "webp",
  gif: "gif",
  avif: "avif",
};

const MIME_FORMATS: Record<string, EligibleImageFormat> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/jpg": "jpeg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

export function imageFormatFromMimeType(
  value: string | undefined,
): EligibleImageFormat | undefined {
  if (!value) return undefined;
  return MIME_FORMATS[value.split(";")[0]!.trim().toLowerCase()];
}

export function imageFormatFromPath(value: string | undefined): EligibleImageFormat | undefined {
  if (!value) return undefined;
  const withoutQuery = value.split(/[?#]/)[0] ?? "";
  const extension = withoutQuery.split(".").pop();
  if (!extension || extension === withoutQuery) return undefined;
  return EXTENSION_FORMATS[extension.toLowerCase()];
}

export function mimeTypeForFormat(format: EligibleImageFormat): string {
  return `image/${format}`;
}

export type ImageUrlCheck = { ok: true; url: string } | { ok: false; reason: string };

const BLOCKED_PROTOCOLS = new Set(["data:", "blob:", "file:", "javascript:", "about:"]);

/**
 * Accepts only public HTTPS URLs: plaintext HTTP, embedded credentials, local
 * and private hosts, and every non-HTTPS scheme are rejected. Shared by image
 * hotlinks and by the attribution links rendered next to them.
 */
export function validatePublicHttpsUrl(value: string): ImageUrlCheck {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2048) return { ok: false, reason: "invalid-url" };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: "invalid-url" };
  }
  if (BLOCKED_PROTOCOLS.has(url.protocol)) return { ok: false, reason: "blocked-protocol" };
  if (url.protocol !== "https:") return { ok: false, reason: "insecure-protocol" };
  if (url.username || url.password) return { ok: false, reason: "credentials-not-allowed" };

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) {
    return { ok: false, reason: "local-hostname" };
  }
  if (!hostname.includes(".") && !hostname.includes(":")) {
    return { ok: false, reason: "local-hostname" };
  }
  if (isNonPublicAddress(hostname)) return { ok: false, reason: "non-public-address" };

  url.hash = "";
  return { ok: true, url: url.toString() };
}

/** True when the value is a public HTTPS URL; convenience over the check result. */
export function isPublicHttpsUrl(value: unknown): boolean {
  return typeof value === "string" && validatePublicHttpsUrl(value).ok;
}

/**
 * Accepts only public HTTPS image URLs. Third-party images are hotlinked, so
 * plaintext HTTP, credentials, private hosts, and non-image encodings such as
 * SVG are rejected before a URL ever reaches the UI.
 */
export function validateImageUrl(value: string): ImageUrlCheck {
  const check = validatePublicHttpsUrl(value);
  if (!check.ok) return check;

  const url = new URL(check.url);
  const format = imageFormatFromPath(url.pathname);
  if (format === undefined && /\.[a-z0-9]{2,5}$/i.test(url.pathname)) {
    return { ok: false, reason: "unsupported-format" };
  }
  return check;
}

function isNonPublicAddress(hostname: string): boolean {
  if (hostname.includes(":")) return isNonPublicIpv6(hostname);
  const parts = hostname.split(".");
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part))) return false;
  return isNonPublicIpv4(parts.map((part) => Number.parseInt(part, 10)));
}

function isNonPublicIpv4(octets: readonly number[]): boolean {
  const [a, b] = octets as [number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

/**
 * Rejects every IPv6 range that cannot host a public image: loopback, the
 * unspecified address, link-local and unique-local ranges, multicast, and the
 * embedded-IPv4 forms, which are judged by the IPv4 rules. An address that
 * cannot be parsed is treated as non-public rather than trusted.
 */
function isNonPublicIpv6(hostname: string): boolean {
  const groups = parseIpv6(hostname);
  if (!groups) return true;

  const [first, second] = groups as [number, number];
  const isZeroPrefix = groups.slice(0, 5).every((group) => group === 0);
  if (isZeroPrefix && (groups[5] === 0 || groups[5] === 0xffff)) {
    const low = [groups[6]!, groups[7]!];
    const octets = [low[0]! >> 8, low[0]! & 0xff, low[1]! >> 8, low[1]! & 0xff];
    if (groups[5] === 0 && groups[6] === 0 && groups[7] !== undefined && groups[7] <= 1) {
      return true;
    }
    return isNonPublicIpv4(octets);
  }
  if ((first & 0xff00) === 0xff00) return true;
  if ((first & 0xffc0) === 0xfe80) return true;
  if ((first & 0xfe00) === 0xfc00) return true;
  if (first === 0x0064 && second === 0xff9b) return true;
  if (first === 0x0100) return true;
  return false;
}

/** Expands an IPv6 literal, including a trailing dotted-quad, into eight groups. */
function parseIpv6(value: string): number[] | undefined {
  let text = value.toLowerCase().split("%")[0] ?? "";
  const dotted = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(text);
  if (dotted) {
    const octets = dotted[1]!.split(".").map((part) => Number.parseInt(part, 10));
    if (octets.some((octet) => !Number.isInteger(octet) || octet > 255)) return undefined;
    const high = ((octets[0]! << 8) | octets[1]!).toString(16);
    const low = ((octets[2]! << 8) | octets[3]!).toString(16);
    text = `${text.slice(0, dotted.index)}${high}:${low}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return undefined;
  const toGroups = (part: string): number[] | undefined => {
    if (!part) return [];
    const groups: number[] = [];
    for (const chunk of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(chunk)) return undefined;
      groups.push(Number.parseInt(chunk, 16));
    }
    return groups;
  };

  const head = toGroups(halves[0] ?? "");
  const tail = halves.length === 2 ? toGroups(halves[1] ?? "") : [];
  if (!head || !tail) return undefined;
  if (halves.length === 1) return head.length === 8 ? head : undefined;
  const fill = 8 - head.length - tail.length;
  if (fill < 1) return undefined;
  return [...head, ...Array.from({ length: fill }, () => 0), ...tail];
}

/** True when the path stays inside the vault and outside Ixplorer's own folders. */
export function isSafeVaultImagePath(path: string): boolean {
  const trimmed = path.trim();
  if (!trimmed || trimmed.length > 1024) return false;
  if (trimmed.startsWith("/") || /^[a-z]:[\\/]/i.test(trimmed)) return false;
  if (trimmed.includes("\\")) return false;
  const segments = trimmed.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return false;
  }
  return !segments[0]!.startsWith(".");
}

/** Rejects spacers and tracking pixels when the source declares dimensions. */
export function hasDisplayableDimensions(width?: number, height?: number): boolean {
  if (width === undefined && height === undefined) return true;
  const edges = [width, height].filter((value): value is number => typeof value === "number");
  if (
    edges.some((edge) => !Number.isFinite(edge) || edge < IMAGE_EXTRACTION_LIMITS.minEdgePixels)
  ) {
    return false;
  }
  if (width !== undefined && height !== undefined) {
    return width * height <= IMAGE_EXTRACTION_LIMITS.maxPixels;
  }
  return true;
}
