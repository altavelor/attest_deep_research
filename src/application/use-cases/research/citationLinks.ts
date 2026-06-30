// Obsidian citation links. This encodes Obsidian's address syntax (block refs
// `#^`, `#page=`), so it is presentation/output knowledge, not platform-neutral
// domain — it must NOT live in core. It sits in application because its only
// consumer (the answer-note formatter) is here and adapters/ui cannot be reached
// from this layer. The principled home is an Obsidian output adapter; that move
// is blocked until the answer-note formatter itself is re-homed there.

import { SourceReference } from "../../../core/model/source";
import { formatCitation } from "../../../core/retrieval/citations";

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
