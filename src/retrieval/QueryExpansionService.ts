import { ChatModelProvider, LanguageInventoryItem, RetrievalQueryVariant } from "../shared/types";
import { detectTextLanguages } from "../indexing/languageDetection";

export interface QueryExpansionServiceOptions {
  chatModel: ChatModelProvider;
  chatModelName: string;
  maxLanguages?: number;
  maxVariants?: number;
}

export interface BuildQueryVariantsOptions {
  query: string;
  languageInventory: LanguageInventoryItem[];
}

const DEFAULT_MAX_LANGUAGES = 4;
const DEFAULT_MAX_VARIANTS = 8;
const UNKNOWN_LANGUAGE = "unknown";
const MAX_QUERY_LENGTH = 240;

export class QueryExpansionService {
  private readonly chatModel: ChatModelProvider;
  private readonly chatModelName: string;
  private readonly maxLanguages: number;
  private readonly maxVariants: number;

  constructor(options: QueryExpansionServiceOptions) {
    this.chatModel = options.chatModel;
    this.chatModelName = options.chatModelName;
    this.maxLanguages = options.maxLanguages ?? DEFAULT_MAX_LANGUAGES;
    this.maxVariants = options.maxVariants ?? DEFAULT_MAX_VARIANTS;
  }

  async buildVariants(options: BuildQueryVariantsOptions): Promise<RetrievalQueryVariant[]> {
    const query = options.query.trim();
    const targetLanguages = this.targetLanguages(query, options.languageInventory);

    if (!query || targetLanguages.length === 0) {
      return [];
    }

    try {
      const response = await collectChatText(
        this.chatModel.streamChat({
          model: this.chatModelName,
          temperature: 0,
          messages: [
            {
              role: "system",
              content:
                "You expand retrieval queries. Return only compact JSON. Never include private vault content.",
            },
            {
              role: "user",
              content: buildQueryExpansionPrompt(query, targetLanguages, this.maxVariants),
            },
          ],
        }),
      );

      return parseQueryVariants(response, this.maxVariants);
    } catch {
      return [];
    }
  }

  private targetLanguages(query: string, inventory: LanguageInventoryItem[]): string[] {
    const queryLanguage = detectTextLanguages(query)[0];
    const languages = inventory
      .filter((item) => item.language !== UNKNOWN_LANGUAGE)
      .sort((left, right) => right.chunkCount - left.chunkCount)
      .map((item) => item.language);
    const unique = Array.from(new Set(languages));
    const targets = unique.filter((language) => language !== queryLanguage);

    return targets.slice(0, this.maxLanguages);
  }
}

export function buildQueryExpansionPrompt(
  query: string,
  targetLanguages: string[],
  maxVariants: number,
): string {
  return [
    "Create retrieval query variants for the user's question.",
    `Target only these languages: ${targetLanguages.join(", ")}.`,
    `Return JSON only in this exact shape: {"queries":[{"query":"...","language":"en","reason":"translated"}]}.`,
    `Return at most ${maxVariants} variants.`,
    "Do not include explanations, markdown, citations, or any source content.",
    "Prefer search phrases that would appear in books and technical documents.",
    "",
    `Question: ${query}`,
  ].join("\n");
}

export function parseQueryVariants(value: string, maxVariants: number): RetrievalQueryVariant[] {
  const parsed = parseJsonObject(value);
  const queries = parsed?.queries;

  if (!Array.isArray(queries)) {
    return [];
  }

  return queries
    .map((item) => normalizeVariant(item))
    .filter((item): item is RetrievalQueryVariant => item !== null)
    .slice(0, maxVariants);
}

async function collectChatText(
  chunks: AsyncIterable<{ content: string; isComplete: boolean }>,
): Promise<string> {
  let text = "";

  for await (const chunk of chunks) {
    text += chunk.content;

    if (chunk.isComplete) {
      break;
    }
  }

  return text;
}

function normalizeVariant(value: unknown): RetrievalQueryVariant | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const item = value as Partial<RetrievalQueryVariant>;
  const query = typeof item.query === "string" ? item.query.replace(/\s+/g, " ").trim() : "";

  if (!query || query.length > MAX_QUERY_LENGTH) {
    return null;
  }

  return {
    query,
    ...(typeof item.language === "string" ? { language: item.language.trim().toLowerCase() } : {}),
    ...(item.reason === "expanded" || item.reason === "translated" || item.reason === "original"
      ? { reason: item.reason }
      : {}),
  };
}

function parseJsonObject(value: string): { queries?: unknown } | null {
  const trimmed = value.trim();
  const jsonStart = trimmed.indexOf("{");
  const jsonEnd = trimmed.lastIndexOf("}");

  if (jsonStart === -1 || jsonEnd <= jsonStart) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1));
    return parsed && typeof parsed === "object" ? (parsed as { queries?: unknown }) : null;
  } catch {
    return null;
  }
}
