import { DEEP_SEARCH_MENTION_INSERT } from "@core/research";

export interface MentionCandidate {
  insertText: string;
  label: string;
  detail: "Document" | "Command";
}

const DEEP_SEARCH_CANDIDATE: MentionCandidate = {
  insertText: DEEP_SEARCH_MENTION_INSERT,
  label: "deep_search",
  detail: "Command",
};

export function getMentionCandidates(
  query: string,
  contextFilePaths: string[],
): MentionCandidate[] {
  const normalizedQuery = query.toLowerCase();

  const commandCandidates = DEEP_SEARCH_CANDIDATE.insertText.includes(normalizedQuery)
    ? [DEEP_SEARCH_CANDIDATE]
    : [];

  const documentCandidates: MentionCandidate[] = contextFilePaths
    .filter((path) => path.toLowerCase().includes(normalizedQuery))
    .map((path) => ({ insertText: path, label: path, detail: "Document" as const }));

  return [...commandCandidates, ...documentCandidates].slice(0, 12);
}
