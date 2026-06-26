import { ChatModelProvider } from "../../core/agent/protocol";
import { RetrievedChunk } from "../../core/model/source";
import { estimateResearchRequestTokens, ResearchChatHistoryMessage } from "../../core/research/prompts";
import { ChatDisplayMessage, ConversationCompactionSummary } from "../../core/conversation";

export const COMPACTION_RECENT_MESSAGE_COUNT = 4;

const SUMMARY_SYSTEM_PROMPT =
  "You summarize chat history for a local-first research assistant. Return valid JSON only.";

const EMPTY_SUMMARY: ConversationCompactionSummary = {
  userGoals: [],
  decisions: [],
  unresolvedQuestions: [],
  citedSourcesAlreadyUsed: [],
};

export interface CompactChatMessagesOptions {
  summary: ConversationCompactionSummary;
  now?: () => Date;
}

export interface CompactChatMessagesResult {
  changed: boolean;
  compactedCount: number;
  messages: ChatDisplayMessage[];
}

export interface ShouldCompactForContextInput {
  question: string;
  messages: ChatDisplayMessage[];
  contextLimitTokens?: number;
  reservedOutputTokens?: number;
}

export async function summarizeCompactionWithModel(options: {
  chatModel: ChatModelProvider;
  model: string;
  messages: ChatDisplayMessage[];
  existingSummary?: ConversationCompactionSummary;
  temperature?: number;
  maxTokens?: number;
}): Promise<ConversationCompactionSummary> {
  const fallback = mergeSummaries(
    options.existingSummary ?? EMPTY_SUMMARY,
    fallbackCompactionSummary(options.messages),
  );

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const content = await collectSummaryResponse(options, fallback);
    const parsed = parseCompactionSummary(content);

    if (parsed) {
      return mergeSummaries(parsed, {
        ...EMPTY_SUMMARY,
        citedSourcesAlreadyUsed: fallback.citedSourcesAlreadyUsed,
      });
    }
  }

  return fallback;
}

export function compactChatMessages(
  messages: ChatDisplayMessage[],
  options: CompactChatMessagesOptions,
): CompactChatMessagesResult {
  const compactableIndexes = compactableMessageIndexes(messages);

  if (compactableIndexes.length === 0) {
    return { changed: false, compactedCount: 0, messages };
  }

  const existingSummary = existingCompactionSummary(messages);
  const compactSummary = mergeSummaries(existingSummary ?? EMPTY_SUMMARY, options.summary);
  const marker = createCompactionMarker(compactSummary, options.now);
  const compactableSet = new Set(compactableIndexes);
  const withoutExistingMarkers = messages.filter((message) => message.kind !== "compact-summary");
  const nextMessages: ChatDisplayMessage[] = [];
  let markerInserted = false;
  let originalIndex = -1;

  for (const message of messages) {
    originalIndex += 1;

    if (message.kind === "compact-summary") {
      continue;
    }

    if (!markerInserted && compactableSet.has(originalIndex)) {
      nextMessages.push(marker);
      markerInserted = true;
    }

    const isCompactable = compactableSet.has(originalIndex);
    nextMessages.push({
      ...message,
      kind: message.kind ?? "message",
      ...(isCompactable ? { compacted: true } : {}),
    });
  }

  if (!markerInserted && withoutExistingMarkers.length > 0) {
    nextMessages.unshift(marker);
  }

  return {
    changed: true,
    compactedCount: compactableIndexes.length,
    messages: nextMessages,
  };
}

export function chatHistoryForPrompt(messages: ChatDisplayMessage[]): ResearchChatHistoryMessage[] {
  return messages
    .filter((message) => {
      if (message.kind === "compact-summary") {
        return true;
      }

      return message.compacted !== true;
    })
    .map((message) => ({
      role: message.role,
      content:
        message.kind === "compact-summary" && message.compactSummary
          ? formatCompactionSummaryForPrompt(message.compactSummary)
          : message.content,
    }));
}

export function shouldCompactForContext(input: ShouldCompactForContextInput): boolean {
  if (!input.contextLimitTokens || compactableMessageIndexes(input.messages).length === 0) {
    return false;
  }

  const estimatedTokens = estimateResearchRequestTokens({
    question: input.question,
    chatHistory: chatHistoryForPrompt(input.messages),
    evidence: [],
    maxEvidenceItems: 0,
    reservedOutputTokens: input.reservedOutputTokens,
  });

  return estimatedTokens > input.contextLimitTokens;
}

export function fallbackCompactionSummary(
  messages: ChatDisplayMessage[],
): ConversationCompactionSummary {
  return {
    userGoals: userMessages(messages).slice(0, 3),
    decisions: assistantMessages(messages).slice(0, 3),
    unresolvedQuestions: questionMessages(messages).slice(-3),
    citedSourcesAlreadyUsed: referencesFromMessages(messages),
  };
}

export function compactableMessages(messages: ChatDisplayMessage[]): ChatDisplayMessage[] {
  const indexes = new Set(compactableMessageIndexes(messages));
  return messages.filter((_, index) => indexes.has(index));
}

export function compactionSummaryFromMessages(
  messages: ChatDisplayMessage[],
): ConversationCompactionSummary | undefined {
  return existingCompactionSummary(messages);
}

export function formatCompactionSummaryForPrompt(summary: ConversationCompactionSummary): string {
  return `Compacted previous chat summary:\n${JSON.stringify(summary)}`;
}

export function buildCompactionMessages(
  longText: string,
  recentQuestion: string,
): ChatDisplayMessage[] {
  return [
    { role: "user", content: longText, createdAt: "2026-06-10T10:00:00.000Z" },
    { role: "assistant", content: longText, createdAt: "2026-06-10T10:00:00.000Z" },
    { role: "user", content: recentQuestion, createdAt: "2026-06-10T10:00:00.000Z" },
    { role: "assistant", content: "Recent answer", createdAt: "2026-06-10T10:00:00.000Z" },
    { role: "user", content: "Newest", createdAt: "2026-06-10T10:00:00.000Z" },
  ];
}

function compactableMessageIndexes(messages: ChatDisplayMessage[]): number[] {
  const visibleIndexes = messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => message.kind !== "compact-summary" && message.compacted !== true);
  const compactable = visibleIndexes.slice(
    0,
    Math.max(0, visibleIndexes.length - COMPACTION_RECENT_MESSAGE_COUNT),
  );

  return compactable.map(({ index }) => index);
}

async function collectSummaryResponse(
  options: {
    chatModel: ChatModelProvider;
    model: string;
    messages: ChatDisplayMessage[];
    existingSummary?: ConversationCompactionSummary;
    temperature?: number;
    maxTokens?: number;
  },
  fallback: ConversationCompactionSummary,
): Promise<string> {
  let content = "";

  for await (const chunk of options.chatModel.streamChat({
    model: options.model,
    temperature: options.temperature ?? 0,
    maxTokens: options.maxTokens,
    messages: [
      { role: "system", content: SUMMARY_SYSTEM_PROMPT },
      {
        role: "user",
        content: buildSummaryPrompt(options.messages, options.existingSummary, fallback),
      },
    ],
  })) {
    content += chunk.content;

    if (chunk.isComplete) {
      break;
    }
  }

  return content;
}

function buildSummaryPrompt(
  messages: ChatDisplayMessage[],
  existingSummary: ConversationCompactionSummary | undefined,
  fallback: ConversationCompactionSummary,
): string {
  return [
    "Summarize the chat history into JSON with exactly these keys:",
    '"userGoals", "decisions", "unresolvedQuestions", "citedSourcesAlreadyUsed".',
    "Each value must be an array of concise strings.",
    "Preserve concrete note paths, URLs, citation IDs, and source labels.",
    "Do not include markdown, code fences, or prose outside the JSON object.",
    "",
    existingSummary ? `Existing compact summary:\n${JSON.stringify(existingSummary)}` : "",
    `Required references to preserve:\n${JSON.stringify(fallback.citedSourcesAlreadyUsed)}`,
    "",
    "Chat history:",
    messages
      .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`)
      .join("\n\n"),
  ].join("\n");
}

function parseCompactionSummary(content: string): ConversationCompactionSummary | null {
  const json = extractJsonObject(content);

  if (!json) {
    return null;
  }

  try {
    const parsed = JSON.parse(json) as Partial<ConversationCompactionSummary>;

    return {
      userGoals: stringArray(parsed.userGoals),
      decisions: stringArray(parsed.decisions),
      unresolvedQuestions: stringArray(parsed.unresolvedQuestions),
      citedSourcesAlreadyUsed: stringArray(parsed.citedSourcesAlreadyUsed),
    };
  } catch {
    return null;
  }
}

function extractJsonObject(content: string): string | null {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");

  return start >= 0 && end > start ? content.slice(start, end + 1) : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
    : [];
}

function createCompactionMarker(
  summary: ConversationCompactionSummary,
  now: (() => Date) | undefined,
): ChatDisplayMessage {
  return {
    role: "assistant",
    kind: "compact-summary",
    compacted: true,
    content: formatCompactionSummaryForPrompt(summary),
    compactSummary: summary,
    createdAt: (now ?? (() => new Date()))().toISOString(),
  };
}

function existingCompactionSummary(
  messages: ChatDisplayMessage[],
): ConversationCompactionSummary | undefined {
  return messages.find((message) => message.kind === "compact-summary")?.compactSummary;
}

function mergeSummaries(
  left: ConversationCompactionSummary,
  right: ConversationCompactionSummary,
): ConversationCompactionSummary {
  return {
    userGoals: uniqueStrings([...left.userGoals, ...right.userGoals]),
    decisions: uniqueStrings([...left.decisions, ...right.decisions]),
    unresolvedQuestions: uniqueStrings([...left.unresolvedQuestions, ...right.unresolvedQuestions]),
    citedSourcesAlreadyUsed: uniqueStrings([
      ...left.citedSourcesAlreadyUsed,
      ...right.citedSourcesAlreadyUsed,
    ]),
  };
}

function userMessages(messages: ChatDisplayMessage[]): string[] {
  return messages
    .filter((message) => message.role === "user")
    .map((message) => message.content.trim())
    .filter(Boolean);
}

function assistantMessages(messages: ChatDisplayMessage[]): string[] {
  return messages
    .filter((message) => message.role === "assistant" && message.kind !== "compact-summary")
    .map((message) => message.content.trim())
    .filter(Boolean);
}

function questionMessages(messages: ChatDisplayMessage[]): string[] {
  return userMessages(messages).filter((message) => message.endsWith("?"));
}

function referencesFromMessages(messages: ChatDisplayMessage[]): string[] {
  const references: string[] = [];

  for (const message of messages) {
    for (const chunk of message.evidence ?? []) {
      references.push(`${chunk.id}: ${sourceLabel(chunk)}`);
    }
  }

  for (const message of messages) {
    references.push(...pathAndUrlReferences(message.content));
  }

  return uniqueStrings(references);
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

function pathAndUrlReferences(content: string): string[] {
  const urls = [...content.matchAll(/https?:\/\/\S+/g)].map((match) =>
    stripTrailingPunctuation(match[0]),
  );
  const paths = [...content.matchAll(/(?:^|\s)([\w@./-]+\/[\w@./-]+\.[A-Za-z0-9]{1,8})/g)].map(
    (match) => stripTrailingPunctuation(match[1]),
  );

  return [...paths, ...urls];
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[),.;]+$/g, "");
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value.trim();

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}
