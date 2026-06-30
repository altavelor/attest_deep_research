import { RetrievalQueryVariant } from "../../core/retrieval/query";
import { ChatModelProvider, ChatRequest } from "../../core/agent/protocol";
import { LanguageInventoryItem } from "../../core/model/citation";
import { detectTextLanguages } from "../indexing/languageDetection";
import {
  collectChatText,
  parseLlmJsonObject,
  type LlmJsonParseDiagnostic,
} from "../../shared/llmOutput";
import { normalizeInlineWhitespace } from "../../shared/whitespace";

export interface QueryExpansionServiceOptions {
  chatModel: ChatModelProvider;
  chatModelName: string;
  chatOptions?: Pick<ChatRequest, "temperature" | "maxTokens">;
  maxLanguages?: number;
  maxVariants?: number;
  onDiagnostic?: (diagnostic: QueryExpansionDiagnostic) => void;
}

export interface BuildQueryVariantsOptions {
  query: string;
  languageInventory: LanguageInventoryItem[];
}

const DEFAULT_MAX_LANGUAGES = 4;
const DEFAULT_MAX_VARIANTS = 8;
const UNKNOWN_LANGUAGE = "unknown";
const MAX_QUERY_LENGTH = 240;
const MAX_LLM_OUTPUT_LENGTH = 20_000;

export interface QueryExpansionDiagnostic extends LlmJsonParseDiagnostic {
  source: "query-expansion";
}

export class QueryExpansionService {
  private readonly chatModel: ChatModelProvider;
  private readonly chatModelName: string;
  private readonly maxLanguages: number;
  private readonly chatOptions?: Pick<ChatRequest, "temperature" | "maxTokens">;
  private readonly maxVariants: number;
  private readonly onDiagnostic?: (diagnostic: QueryExpansionDiagnostic) => void;

  constructor(options: QueryExpansionServiceOptions) {
    this.chatModel = options.chatModel;
    this.chatModelName = options.chatModelName;
    this.chatOptions = options.chatOptions;
    this.maxLanguages = options.maxLanguages ?? DEFAULT_MAX_LANGUAGES;
    this.maxVariants = options.maxVariants ?? DEFAULT_MAX_VARIANTS;
    this.onDiagnostic = options.onDiagnostic;
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
          maxTokens: this.chatOptions?.maxTokens,
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
        { maxLength: MAX_LLM_OUTPUT_LENGTH },
      );

      return parseQueryVariants(response, this.maxVariants, (diagnostic) =>
        this.onDiagnostic?.({ source: "query-expansion", ...diagnostic }),
      );
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

export function parseQueryVariants(
  value: string,
  maxVariants: number,
  onDiagnostic?: (diagnostic: LlmJsonParseDiagnostic) => void,
): RetrievalQueryVariant[] {
  const parsed = parseLlmJsonObject(value, {
    fallback: { queries: [] },
    maxInputLength: MAX_LLM_OUTPUT_LENGTH,
    validate: isQueriesObject,
    onDiagnostic,
  });

  return parsed.queries
    .map((item) => normalizeVariant(item))
    .filter((item): item is RetrievalQueryVariant => item !== null)
    .slice(0, maxVariants);
}

function normalizeVariant(value: unknown): RetrievalQueryVariant | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const item = value as Partial<RetrievalQueryVariant>;
  const query = typeof item.query === "string" ? normalizeInlineWhitespace(item.query) : "";

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

function isQueriesObject(value: unknown): value is { queries: unknown[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { queries?: unknown }).queries)
  );
}
