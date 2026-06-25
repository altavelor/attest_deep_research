// Core retrieval: citation formatting (stage 2). Pure domain logic.

import { Citation } from "../model/citation";
import { SourceReference } from "../model/source";

export function formatCitation(source: SourceReference): Citation {
  return {
    id: source.id,
    source,
    label: citationLabel(source),
  };
}

export function formatCitationLink(source: SourceReference): string {
  const citation = formatCitation(source);

  return `[${citation.label}](${citationTarget(source)})`;
}

function citationLabel(source: SourceReference): string {
  switch (source.kind) {
    case "markdown":
      return source.headingPath.length > 0
        ? `${source.path} > ${source.headingPath.join(" > ")}`
        : source.path;
    case "pdf":
      return `${source.path} p. ${source.pageNumber}`;
    case "document":
      return source.path;
    case "web":
      return source.title;
  }
}

function citationTarget(source: SourceReference): string {
  switch (source.kind) {
    case "markdown":
      return source.blockId ? `${source.path}#^${source.blockId}` : source.path;
    case "pdf":
      return `${source.path}#page=${source.pageNumber}`;
    case "document":
      return source.path;
    case "web":
      return source.url;
  }
}
