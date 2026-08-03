import type { ImageCandidate } from "@core/media";
import type { ImageSearchOptions, ImageSearchSource } from "@application/ports";
import type { WebSourceDescriptor } from "@core/web";
import type { ImageSourceDefinition } from "./engineDefinitions";
import { boundedLimit, ImageSourceHttpOptions, requestImageJson } from "./imageSourceHttp";

export class HttpImageSearchSource implements ImageSearchSource {
  constructor(
    readonly descriptor: WebSourceDescriptor,
    private readonly definition: ImageSourceDefinition,
    private readonly credentials: Record<string, string> = {},
    private readonly options: ImageSourceHttpOptions = {},
  ) {}

  async searchImages(query: string, options: ImageSearchOptions = {}): Promise<ImageCandidate[]> {
    const limit = boundedLimit(options.limit);
    const request = this.definition.buildRequest({
      query,
      limit,
      credentials: this.credentials,
    });
    const payload = await requestImageJson(
      request.url,
      {
        ...(request.method ? { method: request.method } : {}),
        ...(request.headers ? { headers: request.headers } : {}),
        ...(request.body !== undefined ? { body: request.body } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      },
      { ...this.options, ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}) },
      this.descriptor.label,
    );
    return this.definition.parseResponse(payload, this.descriptor.label).slice(0, limit);
  }
}
