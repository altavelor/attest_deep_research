import { ChatMessage, RetrievedChunk } from "../shared/types";

export const RESEARCH_SYSTEM_PROMPT =
  "You are Ixplorer, a local-first Obsidian research assistant. Answer only from provided evidence and preserve citation IDs.";

export interface ResearchChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface BuildResearchPromptOptions {
  question: string;
  chatHistory?: ResearchChatHistoryMessage[];
  evidence: RetrievedChunk[];
  explicitEvidence?: RetrievedChunk[];
  retrievedEvidence?: RetrievedChunk[];
  maxEvidenceItems: number;
}

export interface EstimateResearchRequestTokensOptions extends BuildResearchPromptOptions {
  reservedOutputTokens?: number;
}

const APPROX_CHARS_PER_TOKEN = 4;
const CHAT_MESSAGE_OVERHEAD_TOKENS = 4;
const CHAT_REQUEST_OVERHEAD_TOKENS = 8;

export function buildResearchPrompt(options: BuildResearchPromptOptions): string {
  const explicitEvidence = (options.explicitEvidence ?? [])
    .slice(0, options.maxEvidenceItems)
    .map((chunk) => formatEvidenceItem(chunk))
    .join("\n\n");
  const retrievedEvidence = (options.retrievedEvidence ?? options.evidence)
    .slice(0, options.maxEvidenceItems)
    .map((chunk) => formatEvidenceItem(chunk))
    .join("\n\n");
  const history = formatChatHistory(options.chatHistory ?? []);

  return [
    "Use the context below to answer the user's research question in a detailed, structured way.",
    "Treat explicit context as authoritative when it conflicts with retrieved evidence.",
    "Synthesize all relevant facts from the evidence before concluding.",
    "Cite claims with bracketed citation IDs exactly as shown, for example [chunk-id].",
    "Do not add a separate citations, sources, or bibliography section.",
    "If the evidence is insufficient, say what is missing instead of guessing.",
    "Use the previous chat to resolve references and continue the conversation.",
    "Prefer concrete details, definitions, examples, and relationships found in the evidence.",
    "End with a short 'Follow-up questions:' section containing 1-3 numbered questions.",
    "",
    ...(history ? ["Previous chat:", history, ""] : []),
    `Question: ${options.question}`,
    "",
    explicitEvidence ? `Explicit context:\n${explicitEvidence}` : "Explicit context: None.",
    "",
    retrievedEvidence
      ? `Retrieved evidence:\n${retrievedEvidence}`
      : "Retrieved evidence: No relevant evidence was found.",
  ].join("\n");
}

export function estimateResearchRequestTokens(
  options: EstimateResearchRequestTokensOptions,
): number {
  return (
    estimateChatMessagesTokens([
      { role: "system", content: RESEARCH_SYSTEM_PROMPT },
      { role: "user", content: buildResearchPrompt(options) },
    ]) + (options.reservedOutputTokens ?? 0)
  );
}

export function estimateChatMessagesTokens(messages: ChatMessage[]): number {
  return (
    CHAT_REQUEST_OVERHEAD_TOKENS +
    messages.reduce(
      (total, message) =>
        total +
        CHAT_MESSAGE_OVERHEAD_TOKENS +
        estimateTextTokens(message.role) +
        estimateTextTokens(message.content),
      0,
    )
  );
}

export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / APPROX_CHARS_PER_TOKEN);
}

export function buildDeepResearchPlanPrompt(question: string, maxQueries: number): string {
  return [
    "Create a compact web research query plan for the user's question.",
    `Return JSON only in this exact shape: {"queries":["query one","query two"]}.`,
    `Use 1-${maxQueries} focused web search queries.`,
    "Do not include private notes, vault content, citations, explanations, markdown, or prose.",
    "Prefer precise queries with named entities, date constraints, standards, or source types when useful.",
    "",
    `Question: ${question}`,
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

function formatChatHistory(messages: ResearchChatHistoryMessage[]): string {
  return messages
    .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`)
    .join("\n\n")
    .trim();
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
  return text.replace(/\s+/g, " ").trim();
}
