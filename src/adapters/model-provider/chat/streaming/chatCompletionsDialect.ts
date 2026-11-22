import { ANTHROPIC_REQUEST_HEADERS } from "../../common/anthropicHeaders";

export interface ChatCompletionsDialect {
  readonly id: "anthropic" | "generic";
  readonly defaultMaxTokens?: number;
  readonly sendsReasoningFields: boolean;
  readonly supportsForcedToolChoice: boolean;
  readonly requestHeaders: Readonly<Record<string, string>>;
}

const ANTHROPIC_HOST = "api.anthropic.com";

const anthropicChatDialect: ChatCompletionsDialect = {
  id: "anthropic",
  defaultMaxTokens: 4096,
  sendsReasoningFields: false,
  supportsForcedToolChoice: false,
  requestHeaders: ANTHROPIC_REQUEST_HEADERS,
};

const genericChatDialect: ChatCompletionsDialect = {
  id: "generic",
  sendsReasoningFields: true,
  supportsForcedToolChoice: true,
  requestHeaders: {},
};

/**
 * Picks the Chat Completions request rules by the base URL host only, because the
 * Anthropic endpoint requires `max_tokens` and rejects forced tool choice while
 * every other host, including gateways that route to Claude, takes the generic rules.
 */
export function resolveChatCompletionsDialect(baseUrl: string): ChatCompletionsDialect {
  const host = hostOf(baseUrl);
  return host === ANTHROPIC_HOST || host?.endsWith(`.${ANTHROPIC_HOST}`)
    ? anthropicChatDialect
    : genericChatDialect;
}

function hostOf(baseUrl: string): string | undefined {
  try {
    return new URL(baseUrl.trim()).hostname.toLocaleLowerCase();
  } catch {
    return undefined;
  }
}
