import { Citation } from "@core/model";
import { RetrievedChunk } from "@core/model";
import type { Translate } from "@adapters/i18n";

export function formatCitationForChunk(chunk: RetrievedChunk, t: Translate): Citation {
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
        label: `${chunk.source.path}, ${t("common.pdfPage", { page: chunk.source.pageNumber })}`,
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
