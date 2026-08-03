import { SourceReference } from "@core/model";
import { formatCitation } from "@core/retrieval";

/** Obsidian address for a source (the shared atom; see also ui/conversationFormatting). */
export function citationTarget(source: SourceReference): string {
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

export function formatCitationLink(source: SourceReference): string {
  return `[${formatCitation(source).label}](${citationTarget(source)})`;
}
