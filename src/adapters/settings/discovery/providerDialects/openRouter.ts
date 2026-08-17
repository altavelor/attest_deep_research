import { isRecord } from "@shared";
import { openAiListEntries } from "./entries";
import { ProviderDialect, ProviderModelKinds, includesToken, stringValues } from "./types";

/**
 * OpenRouter describes a model through `architecture.output_modalities`, and
 * omits embedding models from the default listing, so they are requested with
 * an explicit modality filter.
 */
export const openRouterDialect: ProviderDialect = {
  id: "openrouter",
  label: "OpenRouter",
  hosts: ["openrouter.ai"],
  modelListPaths: ["/models", "/models?output_modalities=embeddings"],
  extractEntries: openAiListEntries,
  detectKinds(entry): ProviderModelKinds {
    const architecture = isRecord(entry.architecture) ? entry.architecture : undefined;
    const outputs = stringValues(architecture?.output_modalities);
    const modality = typeof architecture?.modality === "string" ? architecture.modality : "";
    const embeddings =
      includesToken(outputs, "embedding") || modality.toLocaleLowerCase().includes("embedding");
    return { chat: !embeddings, embeddings };
  },
};
