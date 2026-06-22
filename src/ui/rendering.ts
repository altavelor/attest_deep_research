import { IndexingState } from "../indexing/IndexingService";
import { formatIndexSize } from "../indexing/indexSize";
import { Citation, ContextDiagnostics, RetrievedChunk } from "../shared/types";
import { stripRenderedCitationIds } from "./citationText";

export interface ConversationCompactionSummary {
  userGoals: string[];
  decisions: string[];
  unresolvedQuestions: string[];
  citedSourcesAlreadyUsed: string[];
}

export interface ChatDisplayMessage {
  role: "user" | "assistant";
  kind?: "message" | "compact-summary";
  content: string;
  createdAt: string;
  compacted?: boolean;
  compactSummary?: ConversationCompactionSummary;
  evidence?: RetrievedChunk[];
  contextDiagnostics?: ContextDiagnostics;
  reasoning?: Array<{ id: string; content: string }>;
  reasoningOpen?: boolean;
  researchProgress?: AssistantResearchProgress;
}

export interface ReasoningSegment {
  id: string;
  kind: "text" | "summary";
  content: string;
}

export interface AssistantReasoningState {
  phase: "idle" | "streaming" | "complete" | "interrupted";
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  segments: ReasoningSegment[];
}

export interface ResearchProgressCheckpoint {
  id: string;
  round: number;
  content: string;
  status: "streaming" | "complete" | "superseded" | "interrupted";
}

export interface AssistantResearchProgress {
  phase: "idle" | "streaming" | "complete" | "interrupted";
  disclosure: "auto" | "user-open" | "user-closed";
  reasoning: AssistantReasoningState;
  checkpoints: ResearchProgressCheckpoint[];
}

export type CitationTarget = { kind: "obsidian"; target: string } | { kind: "web"; target: string };

export function formatIndexingStatus(state?: IndexingState): string {
  if (!state) {
    return "Index status unavailable";
  }

  const status = formatIndexingStateLabel(state);
  const lastRun = state.lastIndexedAt ? formatDate(state.lastIndexedAt) : "no completed index run";

  if (state.indexedFiles === 0 && state.embeddedChunks === 0) {
    return `${status} · ${lastRun}`;
  }

  return `${status} · ${state.indexedFiles} indexed · ${state.embeddedChunks} chunks · last run ${lastRun}`;
}

export function formatIndexingStateLabel(state: IndexingState): string {
  if (state.status === "error") {
    return "Indexing failed";
  }

  if (state.isStale || state.status === "stale") {
    return "Rebuild needed";
  }

  return state.status[0].toUpperCase() + state.status.slice(1);
}

export function formatIndexControlSummary(state?: IndexingState): string {
  if (!state) {
    return "Index status unavailable";
  }

  const lastRun = state.lastIndexedAt ? formatDate(state.lastIndexedAt) : "Never indexed";

  if (state.status === "error") {
    return state.errorMessage
      ? `Indexing failed · ${state.errorMessage}`
      : `Indexing failed · ${lastRun}`;
  }

  return `${formatIndexingStateLabel(state)} · ${state.indexedFiles} files · ${formatIndexSize(
    state.indexSizeBytes ?? 0,
  )} · ${lastRun}`;
}

export function formatProgressPercent(progress: number): string {
  const bounded = Math.max(0, Math.min(1, progress));
  return `${Math.round(bounded * 100)}%`;
}

export function indexingProgressValue(state: IndexingState): number {
  if (
    state.phase === "embedding" &&
    isPositiveCount(state.chunksTotal) &&
    state.chunksEmbedded !== undefined
  ) {
    return state.chunksEmbedded / state.chunksTotal;
  }

  if (
    isPositiveCount(state.bytesTotal) &&
    state.bytesProcessed !== undefined &&
    (state.phase === "scanning" || state.phase === "checking" || state.phase === "extracting")
  ) {
    return state.bytesProcessed / state.bytesTotal;
  }

  return state.progress;
}

export function formatIndexingProgressLabel(state: IndexingState): string {
  if (state.phase === "embedding" && isPositiveCount(state.chunksTotal)) {
    const chunks = `${state.chunksEmbedded ?? 0} of ${state.chunksTotal} chunks`;
    const batches =
      state.embeddingBatchesTotal && state.embeddingBatchesCompleted !== undefined
        ? ` · ${state.embeddingBatchesCompleted} of ${state.embeddingBatchesTotal} batches`
        : "";

    return `${formatPhase(state.phase)} · ${chunks}${batches}${formatCurrentFile(state)}`;
  }

  return `${formatPhase(state.phase)} · ${state.scannedFiles} of ${
    state.totalFiles
  } files${formatCurrentFile(state)}`;
}

export function citationTarget(citation: Citation): CitationTarget {
  switch (citation.source.kind) {
    case "markdown":
      return {
        kind: "obsidian",
        target: citation.source.blockId
          ? `${citation.source.path}#^${citation.source.blockId}`
          : citation.source.path,
      };
    case "pdf":
      return {
        kind: "obsidian",
        target: `${citation.source.path}#page=${citation.source.pageNumber}`,
      };
    case "document":
      return { kind: "obsidian", target: citation.source.path };
    case "web":
      return { kind: "web", target: citation.source.url };
  }
}

export function nextAssistantMessage(
  messages: ChatDisplayMessage[],
  delta: string,
): ChatDisplayMessage[] {
  const last = messages[messages.length - 1];

  if (last?.role === "assistant") {
    return [
      ...messages.slice(0, -1),
      {
        ...last,
        role: "assistant",
        content: `${last.content}${delta}`,
        createdAt: last.createdAt,
      },
    ];
  }

  return [...messages, { role: "assistant", content: delta, createdAt: new Date().toISOString() }];
}

export function nextAssistantReasoning(
  messages: ChatDisplayMessage[],
  segmentId: string,
  delta: string,
): ChatDisplayMessage[] {
  const last = messages.at(-1);
  const assistant =
    last?.role === "assistant"
      ? last
      : { role: "assistant" as const, content: "", createdAt: new Date().toISOString() };
  const now = new Date().toISOString();
  const progress = researchProgressFromMessage(assistant, now);
  const reasoning = [...progress.reasoning.segments];
  const segmentIndex = reasoning.findIndex((segment) => segment.id === segmentId);
  if (segmentIndex >= 0) {
    reasoning[segmentIndex] = {
      ...reasoning[segmentIndex],
      content: `${reasoning[segmentIndex].content}${delta}`,
    };
  } else {
    reasoning.push({ id: segmentId, kind: "summary", content: delta });
  }
  const updated: ChatDisplayMessage = {
    ...assistant,
    researchProgress: {
      ...progress,
      phase: "streaming",
      reasoning: {
        ...progress.reasoning,
        phase: "streaming",
        startedAt: progress.reasoning.startedAt ?? now,
        segments: reasoning,
      },
    },
  };
  return last?.role === "assistant" ? [...messages.slice(0, -1), updated] : [...messages, updated];
}

export function nextAssistantCheckpoint(
  messages: ChatDisplayMessage[],
  checkpointId: string,
  round: number,
  delta: string,
): ChatDisplayMessage[] {
  const last = messages.at(-1);
  const assistant =
    last?.role === "assistant"
      ? last
      : { role: "assistant" as const, content: "", createdAt: new Date().toISOString() };
  const progress = researchProgressFromMessage(assistant, new Date().toISOString());
  const checkpoints = [...progress.checkpoints];
  const index = checkpoints.findIndex((checkpoint) => checkpoint.id === checkpointId);
  if (index >= 0) {
    checkpoints[index] = {
      ...checkpoints[index],
      content: `${checkpoints[index].content}${delta}`,
      status: "streaming",
    };
  } else {
    checkpoints.push({ id: checkpointId, round, content: delta, status: "streaming" });
  }
  const updated = {
    ...assistant,
    researchProgress: { ...progress, phase: "streaming" as const, checkpoints },
  };
  return last?.role === "assistant" ? [...messages.slice(0, -1), updated] : [...messages, updated];
}

export function completeAssistantCheckpoint(
  messages: ChatDisplayMessage[],
  checkpointId: string,
): ChatDisplayMessage[] {
  const last = messages.at(-1);
  if (last?.role !== "assistant" || !last.researchProgress) return messages;
  return [
    ...messages.slice(0, -1),
    {
      ...last,
      researchProgress: {
        ...last.researchProgress,
        checkpoints: last.researchProgress.checkpoints.map((checkpoint) =>
          checkpoint.id === checkpointId
            ? { ...checkpoint, status: "complete" as const }
            : checkpoint,
        ),
      },
    },
  ];
}

export function resetLastAssistantContent(messages: ChatDisplayMessage[]): ChatDisplayMessage[] {
  const last = messages.at(-1);
  if (last?.role !== "assistant") return messages;
  return [...messages.slice(0, -1), { ...last, content: "" }];
}

export function finalizeLastAssistantReasoning(
  messages: ChatDisplayMessage[],
): ChatDisplayMessage[] {
  const last = messages.at(-1);
  if (last?.role !== "assistant") return messages;
  const progress = last.researchProgress;
  if (!progress) return messages;
  const completedAt = new Date().toISOString();
  const startedAt = progress.reasoning.startedAt;
  return [
    ...messages.slice(0, -1),
    {
      ...last,
      researchProgress: {
        ...progress,
        phase: "complete",
        reasoning: {
          ...progress.reasoning,
          phase: "complete",
          completedAt,
          ...(startedAt
            ? { durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)) }
            : {}),
        },
        checkpoints: progress.checkpoints.map((checkpoint) =>
          checkpoint.status === "streaming"
            ? { ...checkpoint, status: "interrupted" as const }
            : checkpoint,
        ),
      },
    },
  ];
}

export function interruptLastAssistantProgress(
  messages: ChatDisplayMessage[],
): ChatDisplayMessage[] {
  const last = messages.at(-1);
  if (last?.role !== "assistant" || !last.researchProgress) return messages;
  return [
    ...messages.slice(0, -1),
    {
      ...last,
      researchProgress: {
        ...last.researchProgress,
        phase: "interrupted",
        reasoning: { ...last.researchProgress.reasoning, phase: "interrupted" },
        checkpoints: last.researchProgress.checkpoints.map((checkpoint) =>
          checkpoint.status === "streaming"
            ? { ...checkpoint, status: "interrupted" as const }
            : checkpoint,
        ),
      },
    },
  ];
}

function researchProgressFromMessage(
  message: ChatDisplayMessage,
  now: string,
): AssistantResearchProgress {
  if (message.researchProgress) return message.researchProgress;
  return {
    phase: "streaming",
    disclosure: "auto",
    reasoning: {
      phase: "streaming",
      startedAt: now,
      segments: (message.reasoning ?? []).map((segment) => ({ ...segment, kind: "summary" })),
    },
    checkpoints: [],
  };
}

export function attachAnswerDetailsToLastAssistantMessage(
  messages: ChatDisplayMessage[],
  answer: { evidence?: RetrievedChunk[]; contextDiagnostics?: ContextDiagnostics },
): ChatDisplayMessage[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role !== "assistant") {
      continue;
    }

    return [
      ...messages.slice(0, index),
      {
        ...messages[index],
        evidence: answer.evidence ?? [],
        contextDiagnostics: answer.contextDiagnostics,
      },
      ...messages.slice(index + 1),
    ];
  }

  return messages;
}

export function shouldShowDiagnosticAction(
  message: ChatDisplayMessage,
  isDebugMode: boolean,
): boolean {
  return isDebugMode && message.role === "assistant" && message.contextDiagnostics !== undefined;
}

export function stripMessageDiagnostics(messages: ChatDisplayMessage[]): ChatDisplayMessage[] {
  return messages.map((message) => {
    if (message.contextDiagnostics === undefined) {
      return message;
    }

    const { contextDiagnostics: _contextDiagnostics, ...rest } = message;
    return rest;
  });
}

export function messageDisplayContent(message: ChatDisplayMessage): string {
  if (message.role === "user") {
    return message.content;
  }

  return stripRenderedCitationIds(messageMarkdownContent(message)).trim();
}

export function messageMarkdownContent(message: ChatDisplayMessage): string {
  if (message.role === "user") {
    return message.content;
  }

  return cleanupDanglingMarkdown(stripFollowUpSection(stripCitationsSection(message.content)));
}

export function stripFollowUpSection(value: string): string {
  const sectionStart = value.search(/follow-up questions\s*:/i);

  return sectionStart === -1 ? value : value.slice(0, sectionStart).trim();
}

export function stripCitationsSection(value: string): string {
  const sectionStart = value.search(/(?:^|\n)#{1,3}\s*citations\s*$/im);

  return sectionStart === -1 ? value : value.slice(0, sectionStart).trim();
}

export function cleanupDanglingMarkdown(value: string): string {
  return value
    .replace(/(?:\n\s*)+\*\*\s*$/g, "")
    .replace(/\s+\*\*\s*$/g, "")
    .trim();
}

function formatDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatPhase(phase: IndexingState["phase"]): string {
  switch (phase) {
    case "scanning":
      return "Scanning";
    case "checking":
      return "Checking changes";
    case "extracting":
      return "Extracting";
    case "chunking":
      return "Chunking";
    case "embedding":
      return "Embedding";
    case "writing":
      return "Writing index";
    case "complete":
      return "Complete";
    default:
      return "Indexing";
  }
}

function formatCurrentFile(state: IndexingState): string {
  return state.currentFile ? ` · ${shortenPath(state.currentFile)}` : "";
}

function shortenPath(path: string): string {
  if (path.length <= 64) {
    return path;
  }

  return `...${path.slice(-61)}`;
}

function isPositiveCount(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
