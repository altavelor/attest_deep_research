// Wikimedia Commons image search. Uses the MediaWiki generator=search API in
// the File namespace and preserves the file page, thumbnail, creator/credit and
// licence metadata Commons requires for attribution.

import { clampText, hasDisplayableDimensions, ImageCandidate } from "@core/media";
import { imageFormatFromMimeType, imageFormatFromPath } from "@core/media";
import type { ImageSearchOptions, ImageSearchSource } from "@application/ports";
import type { WebSourceDescriptor } from "@core/web";
import {
  boundedLimit,
  ImageSourceHttpOptions,
  list,
  positiveNumber,
  record,
  requestImageJson,
  text,
} from "./imageSourceHttp";

const API_ENDPOINT = "https://commons.wikimedia.org/w/api.php";

export class WikimediaCommonsImageSource implements ImageSearchSource {
  constructor(
    readonly descriptor: WebSourceDescriptor,
    private readonly options: ImageSourceHttpOptions = {},
  ) {}

  async searchImages(query: string, options: ImageSearchOptions = {}): Promise<ImageCandidate[]> {
    const limit = boundedLimit(options.limit);
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      generator: "search",
      gsrsearch: `${query} filetype:bitmap`,
      gsrnamespace: "6",
      gsrlimit: String(limit),
      prop: "imageinfo",
      iiprop: "url|size|mime|extmetadata",
      iiurlwidth: "480",
      origin: "*",
    });
    const payload = await requestImageJson(
      `${API_ENDPOINT}?${params.toString()}`,
      { ...(options.signal ? { signal: options.signal } : {}) },
      { ...this.options, ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}) },
      this.descriptor.label,
    );
    return parseCommonsPayload(payload).slice(0, limit);
  }
}

/** Pure parser over the untrusted MediaWiki payload; exported for tests. */
export function parseCommonsPayload(payload: unknown): ImageCandidate[] {
  const pages = list(record(record(payload).query).pages);
  const candidates: ImageCandidate[] = [];

  for (const page of pages) {
    const entry = record(page);
    const info = record(list(entry.imageinfo)[0]);
    const meta = record(info.extmetadata);
    const fullUrl = text(info.url);
    const descriptionUrl = text(info.descriptionurl);
    if (!fullUrl || !descriptionUrl) continue;

    const format = imageFormatFromMimeType(text(info.mime)) ?? imageFormatFromPath(fullUrl);
    if (!format) continue;

    const width = positiveNumber(info.width);
    const height = positiveNumber(info.height);
    if (!hasDisplayableDimensions(width, height)) continue;

    const title = clampText(text(entry.title)?.replace(/^File:/i, ""), 200) ?? "Commons image";
    const creator = plainText(metaValue(meta, "Artist")) ?? plainText(metaValue(meta, "Credit"));
    const licenceName = plainText(metaValue(meta, "LicenseShortName"));

    candidates.push({
      id: `commons:${descriptionUrl}`,
      origin: "provider",
      format,
      ...(text(info.thumburl) ? { thumbnailUrl: text(info.thumburl)! } : {}),
      fullUrl,
      alt: title,
      ...(creator ? { caption: `${title} — ${creator}` } : { caption: title }),
      sourceUrl: descriptionUrl,
      sourceLabel: creator ? `Wikimedia Commons · ${creator}` : "Wikimedia Commons",
      ...(licenceName ? { licenceName } : {}),
      ...(plainText(metaValue(meta, "LicenseUrl"))
        ? { licenceUrl: plainText(metaValue(meta, "LicenseUrl"))! }
        : {}),
      licensed: Boolean(licenceName),
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
    });
  }
  return candidates;
}

function metaValue(meta: Record<string, unknown>, key: string): string | undefined {
  return text(record(meta[key]).value);
}

/** Commons extmetadata values carry HTML; only the text content is kept. */
function plainText(value: string | undefined): string | undefined {
  return clampText(value?.replace(/<[^>]*>/g, " "), 200);
}
