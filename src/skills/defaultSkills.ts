import { DefaultSkillFile } from "./SkillRegistry";

function defineSkill(options: {
  id: string;
  name: string;
  description: string;
  body: string;
  aliases?: string[];
}): DefaultSkillFile {
  const aliases = options.aliases?.length
    ? ["aliases:", ...options.aliases.map((alias) => `  - ${alias}`)]
    : [];
  return {
    id: options.id,
    content: [
      "---",
      `name: ${options.name}`,
      `description: ${options.description}`,
      ...aliases,
      "version: 1",
      "---",
      "",
      options.body.trim(),
      "",
    ].join("\n"),
  };
}

export const DEFAULT_SKILLS: DefaultSkillFile[] = [
  defineSkill({
    id: "vault-context-assembly",
    name: "Vault Context Assembly",
    description:
      "Answer from vault notes by prioritizing explicit files, the active note, graph context, and RAG evidence.",
    body: `# Vault Context Assembly

Use this skill when the user asks to answer from their notes, explain something from the vault, or find relationships between notes.

## Evidence policy

Use only context the application actually supplied. Interpret it in this order:

1. Explicitly attached or named files.
2. The active note.
3. Links, backlinks, and embeds supplied as graph context.
4. Retrieved RAG chunks.

Explicit evidence wins when sources conflict, but report the conflict. Never claim that a file, backlink, or index was searched unless diagnostics confirms it.

## Output

Answer the question directly, then add a short **Context used** section grouped as Explicit, Active, Graph, and Retrieved. Omit empty groups. State missing context instead of guessing. Preserve every citation ID exactly.`,
  }),
  defineSkill({
    id: "note-synthesis",
    name: "Note Synthesis",
    description:
      "Turn a set of notes into a sourced thematic synthesis with conclusions, contradictions, and missing context.",
    body: `# Note Synthesis

Use this skill for requests to summarize notes, collect conclusions, compare sources, or review a topic.

## Workflow

1. Identify the themes shared across the supplied notes.
2. Group evidence by theme rather than by file order.
3. Separate source statements from your synthesis.
4. Mark conflicting claims explicitly and cite both sides.
5. Do not introduce facts absent from evidence.

## Output

Use these sections: **Overview**, **Themes**, **Conclusions**, **Contradictions**, and **Missing context**. Cite every material conclusion. If a section has no supported content, say so briefly.`,
  }),
  defineSkill({
    id: "literature-review",
    name: "Literature Review",
    description:
      "Create a cited research review that compares authors, claims, evidence, assumptions, and competing approaches.",
    aliases: ["research-review"],
    body: `# Literature Review

Use this skill for collections of papers, PDFs, books, or research notes.

## Workflow

For every source, identify its central thesis, evidence, method or approach, and assumptions. Compare sources on the same dimensions. Distinguish direct evidence from author interpretation and from your synthesis. Build an argument map showing support, disagreement, and unresolved questions.

## Output

Use these sections: **Scope**, **Source positions**, **Comparative analysis**, **Argument map**, **Evidence and assumptions**, **Research gaps**, and **Conclusion**. Every claim about a source must carry its citation. Do not imply consensus from silence or from a single source.`,
  }),
  defineSkill({
    id: "project-memory",
    name: "Project Memory",
    description:
      "Recover project decisions, status, open questions, and historical context from decision and project notes.",
    body: `# Project Memory

Use this skill for questions about past project decisions, current status, unresolved questions, or why a direction was chosen.

## Source policy

Prefer ADRs, decision records, logs, status notes, and dated meeting notes. Distinguish accepted decisions from proposals, ideas, and superseded decisions. Use source dates and modified/frontmatter dates when available.

## Output

Use these sections: **Current status**, **Accepted decisions**, **Open questions**, **Risks and blockers**, and **Proposed summary update**. For each decision include date, source citation, status, and confidence. The summary update is a proposed patch only; never modify the vault.`,
  }),
  defineSkill({
    id: "meeting-notes",
    name: "Meeting Notes",
    description:
      "Extract decisions, action items, owners, dates, risks, blockers, and a follow-up note preview from meeting material.",
    body: `# Meeting Notes

Use this skill to process transcripts, rough meeting notes, or meeting summaries.

## Extraction rules

Separate explicit decisions from suggestions. Extract action items only when an action is stated or clearly assigned. Preserve people, dates, projects, dependencies, risks, and blockers exactly as supported. Mark missing owners or due dates as **Unassigned** or **No due date** rather than inventing them.

## Output

Use these sections: **Summary**, **Decisions**, **Action items**, **Risks and blockers**, **Open questions**, and **Follow-up note preview**. Format action items as checkboxes with owner and due date. Produce a preview only; do not create or update files.`,
  }),
  defineSkill({
    id: "zettelkasten-linker",
    name: "Zettelkasten Linker",
    description:
      "Suggest related notes, backlinks, duplicate topics, and atomic-note splits without changing the vault.",
    body: `# Zettelkasten Linker

Use this skill to find related notes, propose backlinks, decide where a note belongs, or split a broad note.

## Rules

Recommend a link only when evidence shows a meaningful conceptual relationship. Explain the relationship; do not output a bare list of filenames. Identify duplicate topics and distinguish duplication from complementary coverage. Propose atomic notes when one note contains independently reusable ideas.

## Output

Use these sections: **Recommended links**, **Backlink opportunities**, **Possible duplicates**, and **Atomic-note proposals**. Include a reason and confidence for every proposal. Never edit notes or assert that a link already exists unless graph evidence confirms it.`,
  }),
  defineSkill({
    id: "citation-grounded-answer",
    name: "Citation Grounded Answer",
    description:
      "Answer strictly from supplied evidence with a citation for every material verifiable claim and explicit evidence gaps.",
    body: `# Citation Grounded Answer

Use strict evidence-only mode.

## Rules

- Every material verifiable claim must have an adjacent citation ID.
- In vault-only mode, do not use general knowledge, even when it seems obvious.
- Do not cite a source that does not support the claim.
- If evidence is insufficient, write **Not found in the supplied evidence**.
- Preserve ambiguity and disagreement instead of resolving it by guessing.

## Output

Answer directly with claim-level citations. End with exactly these sections:

### Used sources
List only sources actually used.

### Missing evidence
List evidence needed to answer unsupported parts.

### Ambiguities
List conflicting or unclear claims; write **None identified** when appropriate.`,
  }),
  defineSkill({
    id: "contradiction-finder",
    name: "Contradiction Finder",
    description:
      "Find conflicting or outdated claims across notes using source text, dates, and version signals.",
    body: `# Contradiction Finder

Use this skill to check contradictions, outdated material, or competing versions.

## Workflow

1. Normalize claims that refer to the same subject.
2. Compare their meaning, scope, qualifiers, and dates.
3. Distinguish direct contradictions from changed scope, uncertainty, or later supersession.
4. Use modified and frontmatter dates only when supplied.

## Output

For each conflict show **Claim A**, **Claim B**, cited sources, relevant dates, conflict type, and confidence. End with **Recommended review order**, naming which note should be reviewed first and why. Propose updates only; never modify files.`,
  }),
  defineSkill({
    id: "prompt-template-builder",
    name: "Prompt Template Builder",
    description:
      "Turn a successful request into a reusable Obsidian prompt template with variables and an expected output contract.",
    body: `# Prompt Template Builder

Use this skill when the user wants to reuse or generalize a prompt.

## Template rules

Preserve the user's intent while removing one-off details. Add only variables that are useful, choosing from \`{selection}\`, \`{active_note}\`, \`{context}\`, and clearly named task-specific variables. Define constraints and expected output explicitly. Avoid hidden assumptions.

## Output

Return **Template**, **Variables**, **Expected output**, **Usage example**, and **Recommended path**. The template must be valid Markdown ready to copy. Recommend a path under the user's chosen prompt/workflow area, but do not save it.`,
  }),
  defineSkill({
    id: "rag-debugger",
    name: "RAG Debugger",
    description:
      "Diagnose retrieval quality from actual query variants, ranked chunks, scores, filters, budgets, tools, and index state.",
    body: `# RAG Debugger

Use this skill when the user asks why an answer was poor, why a file was not found, which chunks were used, or how RAG behaved.

## Evidence policy

Use only the structured diagnostics supplied by Ixplorer. Never infer a score, rank, filter, tool call, or index event from answer prose. Clearly label unavailable diagnostic fields.

## Output

Use these sections: **Diagnosis**, **Query variants**, **Ranked chunks**, **Dropped and filtered context**, **Token budget**, **Tool calls**, **Index status**, and **Recommendations**. Include path, chunk ID, rank, and score for retrieved chunks. Tie each recommendation to an observed condition; consider reindexing, explicit attachment, graph expansion, query wording, and chunk sizing only when relevant.`,
  }),
];
