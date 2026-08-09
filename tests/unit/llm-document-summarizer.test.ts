import { describe, expect, it, vi } from "vitest";

import {
  LlmDocumentSummarizer,
  parseDocumentSummary,
  SUMMARY_PROMPT_VERSION,
} from "@adapters/indexing/metadata/LlmDocumentSummarizer";

function providerFor(...responses: string[]) {
  let call = 0;
  return {
    streamChat: vi.fn(async function* () {
      const response = responses[call++] ?? "";
      yield { content: response.slice(0, Math.ceil(response.length / 2)) };
      yield { content: response.slice(Math.ceil(response.length / 2)), isComplete: true };
    }),
  };
}

describe("LlmDocumentSummarizer", () => {
  it("streams a bounded section summary using the source and heading context", async () => {
    const provider = providerFor(`  ${"A".repeat(750)}  `);
    const summarizer = new LlmDocumentSummarizer({ provider: provider as never, model: "local" });

    await expect(
      summarizer.summarizeSection({
        sourcePath: "Papers/report.pdf",
        headingPath: ["Methods", "Data"],
        text: "Original section text",
      }),
    ).resolves.toBe("A".repeat(700));
    expect(summarizer.promptVersion).toBe(SUMMARY_PROMPT_VERSION);
    expect(provider.streamChat).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "local",
        messages: expect.arrayContaining([
          expect.objectContaining({ content: expect.stringContaining("Methods > Data") }),
        ]),
      }),
    );
  });

  it("parses a JSON document summary and falls back safely for malformed model output", async () => {
    const provider = providerFor(
      '```json\n{"summary":" Document scope. ","oneLiner":" A document. "}\n```',
      "First sentence. Second sentence without JSON.",
    );
    const summarizer = new LlmDocumentSummarizer({ provider: provider as never, model: "local" });

    await expect(
      summarizer.summarizeDocument({
        sourcePath: "Notes/plan.md",
        title: "Plan",
        sectionSummaries: ["First section", "Second section"],
      }),
    ).resolves.toEqual({ summary: "Document scope.", oneLiner: "A document." });
    await expect(
      summarizer.summarizeDocument({ sourcePath: "Notes/plan.md", sectionSummaries: [] }),
    ).resolves.toEqual({
      summary: "First sentence. Second sentence without JSON.",
      oneLiner: "First sentence.",
    });
  });

  it("uses a deterministic unavailable fallback when the response is empty", () => {
    expect(parseDocumentSummary("   ", { sourcePath: "Papers/missing.pdf" })).toEqual({
      summary: "Summary unavailable for Papers/missing.pdf.",
      oneLiner: "",
    });
  });
});
