export interface SkillMentionOption {
  id: string;
  name: string;
  aliases: string[];
}

export interface MentionCandidate {
  insertText: string;
  label: string;
  detail: "Skill" | "Document";
}

export function getMentionCandidates(
  query: string,
  contextFilePaths: string[],
  skills: SkillMentionOption[],
): MentionCandidate[] {
  const normalizedQuery = query.toLowerCase();
  const skillCandidates: MentionCandidate[] = skills
    .filter((skill) =>
      [skill.id, skill.name, ...skill.aliases].some((value) =>
        value.toLowerCase().includes(normalizedQuery),
      ),
    )
    .map((skill) => ({
      insertText: skill.id,
      label: skill.name,
      detail: "Skill",
    }));
  const documentCandidates: MentionCandidate[] = contextFilePaths
    .filter((path) => path.toLowerCase().includes(normalizedQuery))
    .map((path) => ({ insertText: path, label: path, detail: "Document" }));

  return [...skillCandidates, ...documentCandidates].slice(0, 12);
}
