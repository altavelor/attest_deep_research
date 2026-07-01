import { SUB_AGENT_MENTION_INSERT } from "@core/research";

export interface MentionCandidate {
  insertText: string;
  label: string;
  detail: "Document" | "Command";
}

const SUB_AGENT_CANDIDATE: MentionCandidate = {
  insertText: SUB_AGENT_MENTION_INSERT,
  label: "run_subagent",
  detail: "Command",
};

export function getMentionCandidates(
  query: string,
  contextFilePaths: string[],
): MentionCandidate[] {
  const normalizedQuery = query.toLowerCase();

  const commandCandidates = SUB_AGENT_CANDIDATE.insertText.includes(normalizedQuery)
    ? [SUB_AGENT_CANDIDATE]
    : [];

  const documentCandidates: MentionCandidate[] = contextFilePaths
    .filter((path) => path.toLowerCase().includes(normalizedQuery))
    .map((path) => ({ insertText: path, label: path, detail: "Document" as const }));

  return [...commandCandidates, ...documentCandidates].slice(0, 12);
}
