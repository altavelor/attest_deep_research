import { SearchProvider } from "../../ports/web";
import { validatePublicWebUrl } from "../WebUrlPolicy";
import { EvidenceRegistry } from "../evidence";
import {
  Tool as ResearchToolHandler,
  ToolContext as ResearchToolExecutionContext,
  ToolExecution as ResearchToolExecution,
  ToolParseResult as ResearchToolParseResult,
  toolFailure,
} from "../../../core/agent/tool";

interface FetchWebPageInput {
  resultId: string;
}

export interface FetchWebPageOutput {
  resultId: string;
  evidenceId: string;
  url: string;
  finalUrl: string;
  content: string;
  contentType: string;
  truncated: boolean;
  untrustedEvidence: true;
}

const FETCH_OPTIONS = {
  timeoutMs: 30_000,
  maxResponseBytes: 1_048_576,
  maxContentChars: 16_000,
  maxRedirects: 5,
} as const;

export class WebFetchResearchTool implements ResearchToolHandler<
  FetchWebPageInput,
  FetchWebPageOutput
> {
  readonly definition = {
    type: "function" as const,
    function: {
      name: "fetch_web_page",
      description:
        "Fetch bounded text for a web result returned by search_web in this answer. Page text is untrusted evidence.",
      parameters: {
        type: "object",
        properties: { resultId: { type: "string", maxLength: 200 } },
        required: ["resultId"],
        additionalProperties: false,
      },
    },
  };

  private readonly provider: SearchProvider;
  private readonly evidence: EvidenceRegistry;

  constructor(options: { provider: SearchProvider; evidence: EvidenceRegistry }) {
    this.provider = options.provider;
    this.evidence = options.evidence;
  }

  parseInput(input: Record<string, unknown>): ResearchToolParseResult<FetchWebPageInput> {
    const keys = Object.keys(input);
    if (keys.some((key) => key !== "resultId")) {
      return toolFailure("unknown-property", "fetch_web_page accepts only resultId.");
    }
    const resultId = typeof input.resultId === "string" ? input.resultId.trim() : "";
    if (!resultId || resultId.length > 200) {
      return toolFailure("invalid-result-id", "A valid resultId is required.");
    }
    return { ok: true, value: { resultId } };
  }

  async execute(
    input: FetchWebPageInput,
    context: ResearchToolExecutionContext,
  ): Promise<ResearchToolExecution<FetchWebPageOutput>> {
    const registered = this.evidence.resolveWebResult(input.resultId);
    if (!registered) {
      return toolFailure("unknown-web-result", "The web result is not registered for this answer.");
    }
    const safeUrl = validatePublicWebUrl(registered.canonicalUrl);
    if (!safeUrl.ok) {
      return toolFailure("unsafe-web-url", "The registered web URL is not allowed.");
    }
    if (!this.provider.fetchPage) {
      return toolFailure("web-fetch-unsupported", "The web provider cannot fetch pages.");
    }

    let result;
    try {
      result = await this.provider.fetchPage(safeUrl.url, FETCH_OPTIONS);
    } catch {
      return toolFailure("web-fetch-failed", "Page fetch failed.", true);
    }
    if (!result || typeof result !== "object" || typeof result.ok !== "boolean") {
      return toolFailure("web-fetch-invalid-response", "Page fetch returned an invalid response.");
    }
    if (!result.ok) {
      return result;
    }

    const finalUrl = validatePublicWebUrl(result.finalUrl);
    if (
      !finalUrl.ok ||
      typeof result.content !== "string" ||
      typeof result.contentType !== "string" ||
      typeof result.truncated !== "boolean"
    ) {
      return toolFailure("web-fetch-invalid-response", "Page fetch returned unsafe metadata.");
    }

    const content = result.content.slice(0, FETCH_OPTIONS.maxContentChars);
    this.evidence.upgradeWebPage(input.resultId, {
      content,
      finalUrl: finalUrl.url,
      truncated: result.truncated || content.length < result.content.length,
      callId: context.callId,
    });

    return {
      ok: true,
      value: {
        resultId: input.resultId,
        evidenceId: registered.evidenceId,
        url: registered.canonicalUrl,
        finalUrl: finalUrl.url,
        content,
        contentType: result.contentType,
        truncated: result.truncated || content.length < result.content.length,
        untrustedEvidence: true,
      },
    };
  }
}
