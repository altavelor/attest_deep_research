import { RetrievedChunk } from "../shared/types";

export interface BuildResearchPromptOptions {
  question: string;
  evidence: RetrievedChunk[];
  maxEvidenceItems: number;
}

export function buildResearchPrompt(options: BuildResearchPromptOptions): string {
  const evidence = options.evidence
    .slice(0, options.maxEvidenceItems)
    .map((chunk) => formatEvidenceItem(chunk))
    .join("\n\n");

  return [
    "Use the evidence below to answer the user's research question in a detailed, structured way.",
    "Synthesize all relevant facts from the evidence before concluding.",
    "Cite claims with bracketed citation IDs exactly as shown, for example [chunk-id].",
    "If the evidence is insufficient, say what is missing instead of guessing.",
    "Prefer concrete details, definitions, examples, and relationships found in the evidence.",
    "End with a short 'Follow-up questions:' section containing 1-3 numbered questions.",
    "",
    `Question: ${options.question}`,
    "",
    evidence ? `Evidence:\n${evidence}` : "Evidence: No relevant evidence was found.",
  ].join("\n");
}

export function extractFollowUpQuestions(answer: string): string[] {
  const sectionStart = answer.search(/follow-up questions\s*:/i);

  if (sectionStart === -1) {
    return [];
  }

  return answer
    .slice(sectionStart)
    .split("\n")
    .slice(1)
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim())
    .filter((line) => line.endsWith("?"))
    .slice(0, 3);
}

function formatEvidenceItem(chunk: RetrievedChunk): string {
  return [`[${chunk.id}] ${sourceLabel(chunk)}`, truncateEvidenceText(chunk.text)].join("\n");
}

function sourceLabel(chunk: RetrievedChunk): string {
  switch (chunk.source.kind) {
    case "markdown":
      return chunk.source.headingPath.length > 0
        ? `${chunk.source.path} > ${chunk.source.headingPath.join(" > ")}`
        : chunk.source.path;
    case "pdf":
      return `${chunk.source.path} p. ${chunk.source.pageNumber}`;
    case "document":
      return chunk.source.path;
    case "web":
      return chunk.source.title;
  }
}

function truncateEvidenceText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 2_000);
}
