export interface MentionCandidate {
  insertText: string;
  label: string;
  detail: "Document";
}

export function getMentionCandidates(
  query: string,
  contextFilePaths: string[],
): MentionCandidate[] {
  const normalizedQuery = query.toLowerCase();
  const documentCandidates: MentionCandidate[] = contextFilePaths
    .filter((path) => path.toLowerCase().includes(normalizedQuery))
    .map((path) => ({ insertText: path, label: path, detail: "Document" }));

  return documentCandidates.slice(0, 12);
}
