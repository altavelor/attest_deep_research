// LLM-backed document metadata extraction (SPEC-corpus-knowledge R3). One
// non-streaming chat call per document; the prompt demands strict JSON and the
// parser tolerates fenced or prefixed output. Prompt changes must bump
// EXTRACTION_PROMPT_VERSION so enrichment re-runs on affected sources.

import { ChatMessage, ChatModelProvider } from "@core/agent";
import {
  DocumentMetadataExtractionInput,
  DocumentMetadataExtractor,
  ExtractedDocumentMetadata,
} from "@application/ports";

export const EXTRACTION_PROMPT_VERSION = 2;
const MAX_REFERENCES = 200;

export interface LlmDocumentMetadataExtractorOptions {
  provider: ChatModelProvider;
  model: string;
}

export class LlmDocumentMetadataExtractor implements DocumentMetadataExtractor {
  readonly model: string;
  readonly promptVersion = EXTRACTION_PROMPT_VERSION;
  private readonly provider: ChatModelProvider;

  constructor(options: LlmDocumentMetadataExtractorOptions) {
    this.provider = options.provider;
    this.model = options.model;
  }

  async extract(input: DocumentMetadataExtractionInput): Promise<ExtractedDocumentMetadata> {
    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content:
          `Document path: ${input.sourcePath}\n\n` +
          `--- DOCUMENT HEAD ---\n${input.headSample}\n\n` +
          `--- LIKELY REFERENCES SECTION ---\n${input.referencesSample}`,
      },
    ];

    let text = "";
    for await (const chunk of this.provider.streamChat({ model: this.model, messages })) {
      text += chunk.content ?? "";
    }

    return parseExtractedMetadata(text);
  }
}

const SYSTEM_PROMPT = `You extract bibliographic metadata from document excerpts.
Respond with ONLY a JSON object, no prose, no markdown fence, in this exact shape:
{"title": string|null, "authors": string[], "year": number|null, "abstract": string|null, "references": string[]}
Rules:
- title/authors/year/abstract describe the document itself, taken from the head excerpt.
- abstract: at most 3 sentences; null if the document has none.
- references: bibliography entries cited BY this document, one string per entry, verbatim.
  Only include entries that look like citations of other works. Empty array if none.
- Ground every value in the excerpts. Even if you recognize the work, do NOT fill in
  facts (year, authors, publisher) from your own knowledge — if the excerpts do not
  state it, use null / [].`;

export function parseExtractedMetadata(text: string): ExtractedDocumentMetadata {
  const parsed = extractJsonObject(text);
  if (!parsed) {
    return { references: [] };
  }

  const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
  const abstract = typeof parsed.abstract === "string" ? parsed.abstract.trim() : "";
  const year =
    typeof parsed.year === "number" && Number.isInteger(parsed.year) && parsed.year > 1000
      ? parsed.year
      : undefined;
  const authors = Array.isArray(parsed.authors)
    ? parsed.authors.filter((a): a is string => typeof a === "string" && a.trim().length > 0)
    : [];
  const references = Array.isArray(parsed.references)
    ? parsed.references
        .filter((r): r is string => typeof r === "string" && r.trim().length > 10)
        .slice(0, MAX_REFERENCES)
    : [];

  return {
    ...(title ? { title } : {}),
    ...(authors.length > 0 ? { authors } : {}),
    ...(year ? { year } : {}),
    ...(abstract ? { abstract } : {}),
    references,
  };
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
