import { Citation } from "../../../../../core/model/citation";
import { RetrievedChunk } from "../../../../../core/model/source";

export function formatCitationForChunk(chunk: RetrievedChunk): Citation {
  switch (chunk.source.kind) {
    case "markdown":
      return {
        id: chunk.id,
        label: chunk.source.headingPath.length
          ? `${chunk.source.path} > ${chunk.source.headingPath.join(" > ")}`
          : chunk.source.path,
        source: chunk.source,
      };
    case "pdf":
      return {
        id: chunk.id,
        label: `${chunk.source.path} p. ${chunk.source.pageNumber}`,
        source: chunk.source,
      };
    case "document":
      return {
        id: chunk.id,
        label: chunk.source.path,
        source: chunk.source,
      };
    case "web":
      return {
        id: chunk.id,
        label: chunk.source.url,
        source: chunk.source,
      };
  }
}
