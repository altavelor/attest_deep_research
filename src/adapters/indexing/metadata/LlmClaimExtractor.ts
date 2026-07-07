// LLM-backed claim extraction (SPEC-corpus R7). For one content section the model
// returns a strict-JSON array of short, self-contained claims with a normalized
// subject and free topic tags. Prompt changes must bump CLAIM_PROMPT_VERSION.

import { ChatMessage, ChatModelProvider } from "@core/agent";
import { ClaimExtractionInput, ClaimExtractor, ExtractedClaim } from "@application/ports";

export const CLAIM_PROMPT_VERSION = 1;

const MAX_CLAIMS_PER_SECTION = 8;
const MAX_STATEMENT_CHARS = 300;
const MAX_SUBJECT_CHARS = 120;
const MAX_TOPIC_KEYS = 5;
const MAX_TOPIC_KEY_CHARS = 60;

export interface LlmClaimExtractorOptions {
  provider: ChatModelProvider;
  model: string;
}

const SYSTEM_PROMPT =
  "You extract factual CLAIMS from a document section for a contradiction index. " +
  "A claim is a single, self-contained, checkable assertion the text makes (a fact, " +
  "finding, or position) — not a question, definition, or the section's topic.\n" +
  "Respond with ONLY a JSON array (no prose). Each item:\n" +
  '{"subject": string, "statement": string, "topicKeys": string[]}\n' +
  "- subject: the normalized entity/topic the claim is about (a short noun phrase, " +
  "lower-case, singular), so claims about the same thing from different documents share it.\n" +
  "- statement: the assertion as ONE sentence, self-contained (resolve pronouns), in the " +
  "section's language, quoting the text's meaning — never add outside knowledge.\n" +
  '- topicKeys: 1-3 dotted lower-case tags (e.g. "privacy.mail-forwarding").\n' +
  `Return at most ${MAX_CLAIMS_PER_SECTION} of the most load-bearing claims. If the section ` +
  "states no checkable claims (e.g. it is a heading, table of contents, or references), return [].";

export class LlmClaimExtractor implements ClaimExtractor {
  readonly model: string;
  readonly promptVersion = CLAIM_PROMPT_VERSION;
  private readonly provider: ChatModelProvider;

  constructor(options: LlmClaimExtractorOptions) {
    this.provider = options.provider;
    this.model = options.model;
  }

  async extract(input: ClaimExtractionInput): Promise<ExtractedClaim[]> {
    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content:
          `Document: ${input.sourcePath}\n` +
          `Section: ${input.headingPath.join(" > ") || "(no heading)"}\n\n` +
          input.text,
      },
    ];
    let text = "";
    for await (const chunk of this.provider.streamChat({ model: this.model, messages })) {
      text += chunk.content ?? "";
    }
    return parseExtractedClaims(text);
  }
}

export function parseExtractedClaims(text: string): ExtractedClaim[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }

  const claims: ExtractedClaim[] = [];
  for (const item of parsed) {
    if (claims.length >= MAX_CLAIMS_PER_SECTION) {
      break;
    }
    const claim = normalizeClaim(item);
    if (claim) {
      claims.push(claim);
    }
  }
  return claims;
}

function normalizeClaim(value: unknown): ExtractedClaim | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const statement = typeof record.statement === "string" ? record.statement.trim() : "";
  const subject = typeof record.subject === "string" ? record.subject.trim() : "";
  if (!statement || !subject) {
    return null;
  }
  const topicKeys = Array.isArray(record.topicKeys)
    ? record.topicKeys
        .filter((key): key is string => typeof key === "string")
        .map((key) => key.trim().toLowerCase().slice(0, MAX_TOPIC_KEY_CHARS))
        .filter((key) => key.length > 0)
        .slice(0, MAX_TOPIC_KEYS)
    : [];
  return {
    subject: subject.toLowerCase().slice(0, MAX_SUBJECT_CHARS),
    statement: statement.slice(0, MAX_STATEMENT_CHARS),
    topicKeys,
  };
}
