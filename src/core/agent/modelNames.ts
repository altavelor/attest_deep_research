const ACRONYMS = new Map<string, string>([
  ["ai", "AI"],
  ["gpt", "GPT"],
  ["llm", "LLM"],
  ["moe", "MoE"],
  ["ocr", "OCR"],
  ["oss", "OSS"],
  ["rag", "RAG"],
  ["sql", "SQL"],
  ["stt", "STT"],
  ["tts", "TTS"],
  ["vl", "VL"],
]);

const BRANDS = new Map<string, string>([
  ["deepseek", "DeepSeek"],
  ["gemma", "Gemma"],
  ["minimax", "MiniMax"],
  ["openai", "OpenAI"],
  ["qwq", "QwQ"],
]);

const QUALIFIERS = new Set(["batch", "beta", "extended", "free", "nitro", "preview", "thinking"]);

const SIZE_PATTERN = /^\d+(?:x\d+)?(?:\.\d+)?[bkm]$/i;
const VERSION_PATTERN = /^v\d[\w.]*$/i;

/**
 * Turns a provider model id into a name a person would write. The vendor prefix
 * is dropped because the server profile already names the provider, and a
 * trailing `:` tag becomes a qualifier or a size token. Unknown words are
 * simply capitalised, so an unrecognised id degrades to something readable
 * rather than to nothing.
 */
export function modelDisplayName(modelId: string): string {
  const trimmed = modelId.trim();
  if (!trimmed) {
    return "";
  }

  const [identifier = "", ...tagParts] = trimmed.split(":");
  const tag = tagParts.join(":").trim();
  const base = identifier.slice(identifier.lastIndexOf("/") + 1);
  const words = splitWords(base).map(formatWord);
  if (words.length === 0) {
    return "";
  }

  const name = words.join(" ");
  if (!tag) {
    return name;
  }

  return QUALIFIERS.has(tag.toLocaleLowerCase())
    ? `${name} (${tag.toLocaleLowerCase()})`
    : `${name} ${splitWords(tag).map(formatWord).join(" ")}`.trim();
}

function splitWords(value: string): string[] {
  return value.split(/[-_\s]+/).filter((word) => word.length > 0);
}

function formatWord(word: string): string {
  const lower = word.toLocaleLowerCase();
  const known = BRANDS.get(lower) ?? ACRONYMS.get(lower);
  if (known) {
    return known;
  }

  if (SIZE_PATTERN.test(word)) {
    return word.toLocaleLowerCase().replace(/[bkm]$/, (unit) => unit.toLocaleUpperCase());
  }

  if (VERSION_PATTERN.test(word)) {
    return `v${word.slice(1)}`;
  }

  if (!/[a-z]/i.test(word)) {
    return word;
  }

  return word.charAt(0).toLocaleUpperCase() + word.slice(1);
}
