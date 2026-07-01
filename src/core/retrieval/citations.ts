// Core retrieval: citation formation (stage 2). Pure domain logic — builds the
// domain Citation (id/source/label). The clickable link TARGET (Obsidian `#^` /
// `#page=` syntax) is presentation knowledge and lives outside core, in
// application/use-cases/citationLinks.

import { Citation } from "@core/model/citation";
import { SourceReference } from "@core/model/source";

export function formatCitation(source: SourceReference): Citation {
  return {
    id: source.id,
    source,
    label: sourceLabel(source),
  };
}

/** Human-readable label for a source (path + heading / page number / title). */
export function sourceLabel(source: SourceReference): string {
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
