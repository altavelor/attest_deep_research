import { IndexingState } from "../indexing/IndexingService";
import { Citation } from "../shared/types";

export interface ChatDisplayMessage {
  role: "user" | "assistant";
  content: string;
}

export type CitationTarget = { kind: "obsidian"; target: string } | { kind: "web"; target: string };

export function formatIndexingStatus(state?: IndexingState): string {
  if (!state) {
    return "Index status unavailable";
  }

  const status = state.status[0].toUpperCase() + state.status.slice(1);
  const lastRun = state.lastIndexedAt ? formatDate(state.lastIndexedAt) : "no completed index run";

  if (state.indexedFiles === 0 && state.embeddedChunks === 0) {
    return `${status} · ${lastRun}`;
  }

  return `${status} · ${state.indexedFiles} indexed · ${state.embeddedChunks} chunks · last run ${lastRun}`;
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
        role: "assistant",
        content: `${last.content}${delta}`,
      },
    ];
  }

  return [...messages, { role: "assistant", content: delta }];
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
