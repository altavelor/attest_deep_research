import { ANTHROPIC_REQUEST_HEADERS } from "@adapters/model-provider/common/anthropicHeaders";
import { openAiListEntries } from "./entries";
import { ProviderDialect } from "./types";

export const anthropicDialect: ProviderDialect = {
  id: "anthropic",
  label: "Anthropic",
  hosts: ["api.anthropic.com"],
  modelListPaths: ["/models"],
  extractEntries: openAiListEntries,
  detectKinds: () => ({ chat: true, embeddings: false }),
  requestHeaders: ANTHROPIC_REQUEST_HEADERS,
  embeddingsUnavailable: true,
};
