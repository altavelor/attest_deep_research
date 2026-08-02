// Openverse image search. Preserves the landing page, thumbnail, creator, and
// licence metadata the API supplies. Licence fields are discovery metadata, not
// a legal guarantee — the UI presents them as provider-reported attribution.

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

const API_ENDPOINT = "https://api.openverse.org/v1/images/";

export class OpenverseImageSource implements ImageSearchSource {
  constructor(
    readonly descriptor: WebSourceDescriptor,
    private readonly credentials: Record<string, string> = {},
    private readonly options: ImageSourceHttpOptions = {},
  ) {}

  async searchImages(query: string, options: ImageSearchOptions = {}): Promise<ImageCandidate[]> {
    const limit = boundedLimit(options.limit);
    const params = new URLSearchParams({ q: query, page_size: String(limit) });
    const token = this.credentials.apiKey?.trim();
    const payload = await requestImageJson(
      `${API_ENDPOINT}?${params.toString()}`,
      {
        ...(options.signal ? { signal: options.signal } : {}),
        ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
      },
      { ...this.options, ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}) },
      this.descriptor.label,
    );
    return parseOpenversePayload(payload).slice(0, limit);
  }
}

/** Pure parser over the untrusted Openverse payload; exported for tests. */
export function parseOpenversePayload(payload: unknown): ImageCandidate[] {
  const candidates: ImageCandidate[] = [];

  for (const raw of list(record(payload).results)) {
    const entry = record(raw);
    const fullUrl = text(entry.url);
    const landingUrl = text(entry.foreign_landing_url);
    const id = text(entry.id);
    if (!fullUrl || !landingUrl || !id) continue;

    const format =
      imageFormatFromPath(fullUrl) ??
      imageFormatFromMimeType(text(entry.filetype) ? `image/${text(entry.filetype)}` : undefined);
    if (!format) continue;

    const width = positiveNumber(entry.width);
    const height = positiveNumber(entry.height);
    if (!hasDisplayableDimensions(width, height)) continue;

    const title = clampText(text(entry.title), 200) ?? "Openverse image";
    const creator = clampText(text(entry.creator), 120);
    const licence = text(entry.license);
    const licenceVersion = text(entry.license_version);
    const licenceName = licence
      ? `${licence.toUpperCase()}${licenceVersion ? ` ${licenceVersion}` : ""}`
      : undefined;

    candidates.push({
      id: `openverse:${id}`,
      origin: "provider",
      format,
      ...(text(entry.thumbnail) ? { thumbnailUrl: text(entry.thumbnail)! } : {}),
      fullUrl,
      alt: title,
      caption: clampText(
        text(entry.attribution) ?? (creator ? `${title} — ${creator}` : title),
        500,
      )!,
      sourceUrl: landingUrl,
      sourceLabel: creator ? `Openverse · ${creator}` : "Openverse",
      ...(licenceName ? { licenceName } : {}),
      ...(text(entry.license_url) ? { licenceUrl: text(entry.license_url)! } : {}),
      licensed: Boolean(licenceName),
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
    });
  }
  return candidates;
}
