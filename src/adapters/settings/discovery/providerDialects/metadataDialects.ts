import { isRecord } from "@shared";
import { openAiListEntries } from "./entries";
import {
  ProviderDialect,
  ProviderModelKinds,
  includesToken,
  looksLikeEmbeddingId,
  modelIdFrom,
  stringValues,
} from "./types";

/** DeepInfra tags each model inside `metadata.tags`, using `embed` for embeddings. */
export const deepInfraDialect: ProviderDialect = {
  id: "deepinfra",
  label: "DeepInfra",
  hosts: ["deepinfra.com"],
  modelListPaths: ["/models"],
  extractEntries: openAiListEntries,
  detectKinds(entry): ProviderModelKinds {
    const metadata = isRecord(entry.metadata) ? entry.metadata : undefined;
    const tags = stringValues(metadata?.tags);
    if (tags.length === 0) {
      return fallbackKinds(entry);
    }
    const embeddings = includesToken(tags, "embed");
    return { chat: !embeddings, embeddings };
  },
};

const NON_CHAT_TOGETHER_TYPES = ["rerank", "image", "audio", "video", "moderation"];

/** Together AI declares an explicit `type` such as `chat`, `embedding`, or `rerank`. */
export const togetherDialect: ProviderDialect = {
  id: "together",
  label: "Together AI",
  hosts: ["together.xyz", "together.ai"],
  modelListPaths: ["/models"],
  extractEntries: openAiListEntries,
  detectKinds(entry): ProviderModelKinds {
    const type = typeof entry.type === "string" ? entry.type.toLocaleLowerCase() : "";
    if (type.includes("embedding")) {
      return { chat: false, embeddings: true };
    }
    if (type.includes("chat") || type.includes("language")) {
      return { chat: true, embeddings: false };
    }
    if (NON_CHAT_TOGETHER_TYPES.some((candidate) => type.includes(candidate))) {
      return { chat: false, embeddings: false };
    }
    return fallbackKinds(entry);
  },
};

/** Mistral exposes a `capabilities` object whose `completion_chat` marks chat models. */
export const mistralDialect: ProviderDialect = {
  id: "mistral",
  label: "Mistral",
  hosts: ["mistral.ai"],
  modelListPaths: ["/models"],
  extractEntries: openAiListEntries,
  detectKinds(entry): ProviderModelKinds {
    const capabilities = isRecord(entry.capabilities) ? entry.capabilities : undefined;
    if (typeof capabilities?.completion_chat !== "boolean") {
      return fallbackKinds(entry);
    }
    const chat = capabilities.completion_chat;
    return { chat, embeddings: !chat && fallbackKinds(entry).embeddings };
  },
};

function fallbackKinds(entry: Record<string, unknown>): ProviderModelKinds {
  const id = modelIdFrom(entry) ?? "";
  const embeddings = looksLikeEmbeddingId(id);
  return { chat: !embeddings, embeddings };
}

export { fallbackKinds };
