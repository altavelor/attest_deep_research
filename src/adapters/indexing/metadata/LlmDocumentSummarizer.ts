import { ChatMessage, ChatModelProvider } from "@core/agent";
import { DocumentSummarizer, DocumentSummaryInput, SectionSummaryInput } from "@application/ports";

export const SUMMARY_PROMPT_VERSION = 1;
const MAX_SECTION_SUMMARY_CHARS = 700;
const MAX_DOCUMENT_SUMMARY_CHARS = 1_200;
const MAX_ONE_LINER_CHARS = 220;

export interface LlmDocumentSummarizerOptions {
  provider: ChatModelProvider;
  model: string;
}

export class LlmDocumentSummarizer implements DocumentSummarizer {
  readonly model: string;
  readonly promptVersion = SUMMARY_PROMPT_VERSION;
  private readonly provider: ChatModelProvider;

  constructor(options: LlmDocumentSummarizerOptions) {
    this.provider = options.provider;
    this.model = options.model;
  }

  async summarizeSection(input: SectionSummaryInput): Promise<string> {
    const text = await this.complete([
      {
        role: "system",
        content:
          "Summarize the given document section in 2-4 sentences, in the language of the section. " +
          "State only what the text says — no meta commentary, no markdown, plain text only.",
      },
      {
        role: "user",
        content:
          `Document: ${input.sourcePath}\nSection: ${input.headingPath.join(" > ") || "(no heading)"}\n\n` +
          input.text,
      },
    ]);
    return text.trim().slice(0, MAX_SECTION_SUMMARY_CHARS);
  }

  async summarizeDocument(
    input: DocumentSummaryInput,
  ): Promise<{ summary: string; oneLiner: string }> {
    const text = await this.complete([
      {
        role: "system",
        content:
          "You summarize a document from its section summaries. Respond with ONLY a JSON object:\n" +
          '{"summary": string, "oneLiner": string}\n' +
          "summary: 3-6 sentences covering the document's scope and main claims, in the document's language.\n" +
          "oneLiner: one sentence naming what the document is and what it covers.\n" +
          "Ground everything in the provided summaries — do not add outside knowledge.",
      },
      {
        role: "user",
        content:
          `Document: ${input.title ?? input.sourcePath}\n\n` +
          input.sectionSummaries.map((summary, index) => `${index + 1}. ${summary}`).join("\n"),
      },
    ]);
    return parseDocumentSummary(text, input);
  }

  private async complete(messages: ChatMessage[]): Promise<string> {
    let text = "";
    for await (const chunk of this.provider.streamChat({ model: this.model, messages })) {
      text += chunk.content ?? "";
    }
    return text;
  }
}

export function parseDocumentSummary(
  text: string,
  input: { sourcePath: string },
): { summary: string; oneLiner: string } {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
      const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
      const oneLiner = typeof parsed.oneLiner === "string" ? parsed.oneLiner.trim() : "";
      if (summary) {
        return {
          summary: summary.slice(0, MAX_DOCUMENT_SUMMARY_CHARS),
          oneLiner: (oneLiner || summary).slice(0, MAX_ONE_LINER_CHARS),
        };
      }
    } catch {}
  }
  const fallback = text.trim().slice(0, MAX_DOCUMENT_SUMMARY_CHARS);
  const firstSentence = fallback.split(/(?<=[.!?])\s/)[0] ?? fallback;
  return {
    summary: fallback || `Summary unavailable for ${input.sourcePath}.`,
    oneLiner: (firstSentence || fallback).slice(0, MAX_ONE_LINER_CHARS),
  };
}
