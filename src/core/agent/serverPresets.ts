import { ApiFormat } from "./protocol";

export interface ServerPreset {
  readonly id: string;
  readonly label: string;
  readonly apiFormat: ApiFormat;
  readonly baseUrl: string;
}

export const CUSTOM_SERVER_PRESET_ID = "custom";

const preset = (
  id: string,
  label: string,
  baseUrl: string,
  apiFormat: ApiFormat = "openai-compatible",
): ServerPreset => ({ id, label, apiFormat, baseUrl });

export const SERVER_PRESETS: readonly ServerPreset[] = [
  preset("openai", "OpenAI", "https://api.openai.com/v1"),
  preset("anthropic", "Anthropic", "https://api.anthropic.com/v1", "anthropic"),
  preset("openrouter", "OpenRouter", "https://openrouter.ai/api/v1"),
  preset("mistral", "Mistral", "https://api.mistral.ai/v1"),
  preset("groq", "Groq", "https://api.groq.com/openai/v1"),
  preset("deepseek", "DeepSeek", "https://api.deepseek.com"),
  preset("together", "Together AI", "https://api.together.xyz/v1"),
  preset("deepinfra", "DeepInfra", "https://api.deepinfra.com/v1/openai"),
  preset("fireworks", "Fireworks AI", "https://api.fireworks.ai/inference/v1"),
  preset("cerebras", "Cerebras", "https://api.cerebras.ai/v1"),
  preset("nebius", "Nebius AI Studio", "https://api.studio.nebius.com/v1"),
  preset("novita", "Novita AI", "https://api.novita.ai/v3/openai"),
  preset("ollama", "Ollama (local)", "http://localhost:11434", "ollama"),
  preset("lmstudio", "LM Studio (local)", "http://localhost:1234/v1"),
];

export function findServerPreset(presetId: string): ServerPreset | undefined {
  return SERVER_PRESETS.find((candidate) => candidate.id === presetId);
}

/**
 * Finds the preset a saved profile came from so an edited profile reopens with
 * its provider selected. Matching uses the base URL alone, because the stored
 * API format can be changed by hand after the preset filled it in.
 */
export function matchServerPreset(baseUrl: string): ServerPreset | undefined {
  const normalized = comparableUrl(baseUrl);
  if (!normalized) {
    return undefined;
  }

  return SERVER_PRESETS.find((candidate) => comparableUrl(candidate.baseUrl) === normalized);
}

function comparableUrl(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\/+$/, "");
}
