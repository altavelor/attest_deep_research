import { formatCitationLink } from "../retrieval/citations";
import { ResearchAnswer } from "../shared/types";

export function formatResearchAnswerNote(answer: ResearchAnswer): string {
  return [
    "# Ixplorer Research",
    "",
    `**Created:** ${answer.createdAt}`,
    "",
    "## Question",
    "",
    answer.question,
    "",
    "## Answer",
    "",
    answer.answer,
    "",
    "## Citations",
    "",
    citationsMarkdown(answer),
    "",
    "## Follow-up Questions",
    "",
    followUpsMarkdown(answer),
    "",
  ].join("\n");
}

export function researchAnswerNotePath(answer: ResearchAnswer): string {
  const date = answer.createdAt.slice(0, 10);
  const slug = slugify(answer.question) || "research-answer";

  return `Ixplorer/${date}-${slug}.md`;
}

export function formatResearchAnswerAppendBlock(answer: ResearchAnswer): string {
  return `\n\n${formatResearchAnswerNote(answer)}`;
}

function citationsMarkdown(answer: ResearchAnswer): string {
  if (answer.citations.length === 0) {
    return "No citations.";
  }

  return answer.citations
    .map((citation, index) => `${index + 1}. ${formatCitationLink(citation.source)}`)
    .join("\n");
}

function followUpsMarkdown(answer: ResearchAnswer): string {
  if (answer.followUpQuestions.length === 0) {
    return "No follow-up questions.";
  }

  return answer.followUpQuestions.map((question, index) => `${index + 1}. ${question}`).join("\n");
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
}
