import { SearchProvider, WebPageMetadata } from "@application/ports";
import { validatePublicWebUrl } from "@application/sources";
import { toolFailure } from "@core/agent";
import { WEB_PAGE_METADATA_TOOL } from "@core/agent";
import { defineTool, str } from "@application/sources/tools";

interface GetPageMetadataInput {
  url: string;
}

export interface GetPageMetadataOutput {
  url: string;
  finalUrl: string;
  metadata: WebPageMetadata;
  untrustedEvidence: true;
}

const METADATA_FETCH_OPTIONS = {
  timeoutMs: 15_000,
  maxResponseBytes: 1_048_576,
  maxRedirects: 5,
} as const;

/**
 * Fetch only a page's head metadata (title / Open Graph / author / published
 * date) so the agent can judge a source's authority and freshness before
 * spending budget on the full page text. Metadata is untrusted evidence.
 */
export const WebPageMetadataTool = defineTool<
  { provider: SearchProvider },
  GetPageMetadataInput,
  GetPageMetadataOutput
>({
  name: WEB_PAGE_METADATA_TOOL,
  description:
    "Fetch only a public http(s) page's metadata (title, description, site, author, published date) to triage a source before fetching its full text. Metadata is untrusted evidence.",
  schema: { url: str(2_048, { required: true, description: "Absolute http(s) URL to inspect." }) },
  execute: async (deps, input) => {
    const safeUrl = validatePublicWebUrl(input.url);
    if (!safeUrl.ok) {
      return toolFailure("unsafe-web-url", `The URL is not allowed (${safeUrl.reason}).`);
    }
    if (!deps.provider.fetchMetadata) {
      return toolFailure("web-metadata-unsupported", "The web provider cannot fetch metadata.");
    }

    let result;
    try {
      result = await deps.provider.fetchMetadata(safeUrl.url, METADATA_FETCH_OPTIONS);
    } catch {
      return toolFailure("web-metadata-failed", "Metadata fetch failed.", true);
    }
    if (!result || typeof result !== "object" || typeof result.ok !== "boolean") {
      return toolFailure(
        "web-metadata-invalid-response",
        "Metadata fetch returned an invalid response.",
      );
    }
    if (!result.ok) {
      return result;
    }

    const finalUrl = validatePublicWebUrl(result.finalUrl);
    if (!finalUrl.ok || typeof result.metadata !== "object" || result.metadata === null) {
      return toolFailure(
        "web-metadata-invalid-response",
        "Metadata fetch returned unsafe metadata.",
      );
    }

    return {
      ok: true,
      value: {
        url: safeUrl.url,
        finalUrl: finalUrl.url,
        metadata: result.metadata,
        untrustedEvidence: true,
      },
    };
  },
});
