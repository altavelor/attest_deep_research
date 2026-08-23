import { formatCitationLink } from "./citationLinks";
import { linkifyUrlCitations } from "./urlCitations";
import { AnswerWebReference, ResearchAnswer } from "@core/answer";
import { chartDataTable, sanitizeAnswerArtifacts, type AnswerImage } from "@core/media";
import { Citation } from "@core/model";
import { replaceCitationTokens } from "@core/research";

export function formatResearchAnswerNote(answer: ResearchAnswer): string {
  const citations = dedupeCitationsById(answer.citations);
  const webReferences = answer.webReferences ?? [];
  return [
    "# Attest Research",
    "",
    `**Created:** ${answer.createdAt}`,
    "",
    "## Question",
    "",
    answer.question,
    "",
    "## Answer",
    "",
    renderAnswerBody(answer, citations, webReferences),
    "",
    ...artifactSections(answer),
    "## Citations",
    "",
    citationsMarkdown(citations, webReferences),
    "",
    "## Follow-up Questions",
    "",
    followUpsMarkdown(answer),
    "",
  ].join("\n");
}

function renderAnswerBody(
  answer: ResearchAnswer,
  dedupedCitations: Citation[],
  webReferences: readonly AnswerWebReference[],
): string {
  const numberById = new Map(dedupedCitations.map((citation, index) => [citation.id, index + 1]));
  webReferences.forEach((reference, index) => {
    numberById.set(reference.id, dedupedCitations.length + index + 1);
  });

  const numbered = replaceCitationTokens(
    answer.answer,
    new Set(numberById.keys()),
    (label) => `[${numberById.get(label)}]`,
  );

  return linkifyUrlCitations(numbered);
}

/**
 * Exports the answer's artifacts as Markdown: galleries become an attribution
 * and source-link table, charts become their equivalent data table. Image bytes
 * are never written into the note.
 */
function artifactSections(answer: ResearchAnswer): string[] {
  const artifacts = sanitizeAnswerArtifacts(answer.artifacts);
  if (!artifacts) return [];

  const sections: string[] = [];
  for (const artifact of artifacts) {
    if (artifact.type === "image-gallery") {
      sections.push(
        `## ${artifact.title ?? "Images"}`,
        "",
        "| Image | Source | Licence |",
        "| --- | --- | --- |",
        ...artifact.images.map((image) =>
          [
            "",
            escapeTableCell(image.alt || image.sourceLabel),
            galleryImageLink(image),
            escapeTableCell(
              image.licensed === true ? (image.licenceName ?? "—") : "Page reference",
            ),
            "",
          ].join(" | "),
        ),
        "",
      );
      continue;
    }
    sections.push(
      `## ${artifact.title}`,
      "",
      chartDataTable(artifact),
      "",
      ...(artifact.caption ? [artifact.caption, ""] : []),
    );
  }
  return sections;
}

/**
 * Attribution comes from fetched pages and providers, so it is untrusted text.
 * A label that cannot be escaped safely, or a destination that could terminate
 * the link, degrades to plain text rather than emitting extra Markdown.
 */
function galleryImageLink(image: AnswerImage): string {
  const label = escapeLinkText(image.sourceLabel);
  if (/^https?:\/\//i.test(image.sourceUrl)) {
    const destination = markdownLinkDestination(image.sourceUrl);
    return destination ? `[${label}](${destination})` : label;
  }
  return /[[\]|]/.test(image.sourceUrl) ? label : `[[${image.sourceUrl}]]`;
}

function markdownLinkDestination(url: string): string | undefined {
  if (/[\s<>]/.test(url)) return undefined;
  return url.replace(/\(/g, "%28").replace(/\)/g, "%29");
}

function escapeLinkText(value: string): string {
  return escapeTableCell(value).replace(/([[\]])/g, "\\$1");
}

function escapeTableCell(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/[\r\n]+/g, " ");
}

export function researchAnswerNotePath(answer: ResearchAnswer): string {
  const date = answer.createdAt.slice(0, 10);
  const slug = slugify(answer.question) || "research-answer";

  return `Attest/${date}-${slug}.md`;
}

export function formatResearchAnswerAppendBlock(answer: ResearchAnswer): string {
  return `\n\n${formatResearchAnswerNote(answer)}`;
}

function citationsMarkdown(
  citations: Citation[],
  webReferences: readonly AnswerWebReference[],
): string {
  const entries = [
    ...citations.map((citation) => formatCitationLink(citation.source)),
    ...webReferences.map((reference) => webReferenceLink(reference)),
  ];
  if (entries.length === 0) {
    return "No citations.";
  }

  return entries.map((entry, index) => `${index + 1}. ${entry}`).join("\n");
}

/** Renders a cited page that produced no evidence; a URL that cannot be a safe
 * link destination degrades to plain text. */
function webReferenceLink(reference: AnswerWebReference): string {
  const destination = markdownLinkDestination(reference.url);
  const label = escapeLinkText(reference.url);
  return destination ? `[${label}](${destination})` : label;
}

function dedupeCitationsById(citations: Citation[]): Citation[] {
  const seen = new Set<string>();
  const deduped: Citation[] = [];

  for (const citation of citations) {
    if (seen.has(citation.id)) {
      continue;
    }

    seen.add(citation.id);
    deduped.push(citation);
  }

  return deduped;
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
