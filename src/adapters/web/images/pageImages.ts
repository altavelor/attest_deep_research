// Extracts image candidates from fetched page HTML. Social preview images win
// over content images; everything else keeps document order. HTML is untrusted,
// so only attribute values that survive URL and format validation are kept.

import {
  clampText,
  hasDisplayableDimensions,
  ImageCandidate,
  IMAGE_EXTRACTION_LIMITS,
  imageFormatFromPath,
  validateImageUrl,
} from "@core/media";

const META_TAG = /<meta\b[^>]*>/gi;
const IMG_TAG = /<img\b[^>]*>/gi;
const TITLE_TAG = /<title[^>]*>([\s\S]{0,300}?)<\/title>/i;
const LINK_CANONICAL = /<link\b[^>]*rel=["']?canonical["']?[^>]*>/i;

export interface PageImageExtractionInput {
  html: string;
  /** Final URL after redirects; used to resolve relative sources. */
  baseUrl: string;
}

/**
 * Collects up to eight page-referenced images with the page as attribution.
 * Page images are references, never licensed content, so no licence metadata is
 * attached.
 */
export function extractPageImages(input: PageImageExtractionInput): ImageCandidate[] {
  const pageTitle = clampText(decodeEntities(TITLE_TAG.exec(input.html)?.[1] ?? ""), 200);
  const canonical = resolveUrl(
    attribute(LINK_CANONICAL.exec(input.html)?.[0] ?? "", "href"),
    input.baseUrl,
  );
  const sourceUrl = canonical ?? input.baseUrl;
  const sourceLabel = pageTitle ?? hostOf(sourceUrl) ?? sourceUrl;

  const seen = new Set<string>();
  const candidates: ImageCandidate[] = [];

  const push = (
    rawUrl: string | undefined,
    alt: string | undefined,
    dimensions?: {
      width?: number;
      height?: number;
    },
  ): void => {
    if (candidates.length >= IMAGE_EXTRACTION_LIMITS.candidatesPerSource) return;
    const resolved = resolveUrl(rawUrl, input.baseUrl);
    if (!resolved) return;
    const checked = validateImageUrl(resolved);
    if (!checked.ok) return;
    if (seen.has(checked.url)) return;
    if (!hasDisplayableDimensions(dimensions?.width, dimensions?.height)) return;
    seen.add(checked.url);
    candidates.push({
      id: `page:${checked.url}`,
      origin: "page",
      ...(imageFormatFromPath(checked.url) ? { format: imageFormatFromPath(checked.url)! } : {}),
      fullUrl: checked.url,
      alt: clampText(alt, 300) ?? pageTitle ?? "Image from the referenced page",
      ...(pageTitle ? { caption: pageTitle } : {}),
      sourceUrl,
      sourceLabel,
      ...(dimensions?.width ? { width: dimensions.width } : {}),
      ...(dimensions?.height ? { height: dimensions.height } : {}),
    });
  };

  for (const tag of input.html.match(META_TAG) ?? []) {
    const key = (attribute(tag, "property") ?? attribute(tag, "name") ?? "").toLowerCase();
    if (key === "og:image" || key === "og:image:secure_url" || key === "twitter:image") {
      push(attribute(tag, "content"), pageTitle);
    }
  }

  for (const tag of input.html.match(IMG_TAG) ?? []) {
    push(attribute(tag, "src") ?? firstSrcSetUrl(attribute(tag, "srcset")), attribute(tag, "alt"), {
      ...(numericAttribute(tag, "width") !== undefined
        ? { width: numericAttribute(tag, "width")! }
        : {}),
      ...(numericAttribute(tag, "height") !== undefined
        ? { height: numericAttribute(tag, "height")! }
        : {}),
    });
  }

  return candidates;
}

function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  const raw = match?.[2] ?? match?.[3] ?? match?.[4];
  return raw ? decodeEntities(raw).trim() : undefined;
}

function numericAttribute(tag: string, name: string): number | undefined {
  const value = Number.parseInt(attribute(tag, name) ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function firstSrcSetUrl(value: string | undefined): string | undefined {
  return value?.split(",")[0]?.trim().split(/\s+/)[0];
}

function resolveUrl(value: string | undefined, baseUrl: string): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function hostOf(value: string): string | undefined {
  try {
    return new URL(value).hostname;
  } catch {
    return undefined;
  }
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]*>/g, " ");
}
