import { openAiListEntries } from "./entries";
import { fallbackKinds } from "./metadataDialects";
import { ProviderDialect } from "./types";

function flatDialect(id: string, label: string, hosts: readonly string[]): ProviderDialect {
  return {
    id,
    label,
    hosts,
    modelListPaths: ["/models"],
    extractEntries: openAiListEntries,
    detectKinds: fallbackKinds,
  };
}

export const openAiDialect = flatDialect("openai", "OpenAI", ["api.openai.com"]);
export const groqDialect = flatDialect("groq", "Groq", ["api.groq.com"]);
export const fireworksDialect = flatDialect("fireworks", "Fireworks AI", ["api.fireworks.ai"]);
export const deepSeekDialect = flatDialect("deepseek", "DeepSeek", ["api.deepseek.com"]);
export const cerebrasDialect = flatDialect("cerebras", "Cerebras", ["api.cerebras.ai"]);
export const nebiusDialect = flatDialect("nebius", "Nebius AI Studio", ["api.studio.nebius.com"]);
export const novitaDialect = flatDialect("novita", "Novita AI", ["api.novita.ai"]);
export const genericOpenAiDialect = flatDialect("openai-compatible", "OpenAI-compatible", []);
