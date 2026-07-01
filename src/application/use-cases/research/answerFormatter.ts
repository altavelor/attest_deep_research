import { formatCitationLink } from "./citationLinks";
import { linkifyUrlCitations } from "./urlCitations";
import { ResearchAnswer } from "@core/answer";
import { Citation } from "@core/model";

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
    linkifyUrlCitations(answer.answer),
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
  const citations = dedupeCitationsBySource(answer.citations);

  if (citations.length === 0) {
    return "No citations.";
  }

  return citations
    .map((citation, index) => `${index + 1}. ${formatCitationLink(citation.source)}`)
    .join("\n");
}

function dedupeCitationsBySource(citations: Citation[]): Citation[] {
  const seen = new Set<string>();
  const deduped: Citation[] = [];

  for (const citation of citations) {
    const key = citationSourceKey(citation);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(citation);
  }

  return deduped;
}

function citationSourceKey(citation: Citation): string {
  switch (citation.source.kind) {
    case "markdown":
      return [
        "markdown",
        citation.source.path,
        citation.source.blockId ?? "",
        citation.source.headingPath.join("/"),
      ].join(":");
    case "pdf":
      return ["pdf", citation.source.path, citation.source.pageNumber].join(":");
    case "document":
      return ["document", citation.source.path, citation.source.format].join(":");
    case "web":
      return ["web", citation.source.url].join(":");
  }
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
