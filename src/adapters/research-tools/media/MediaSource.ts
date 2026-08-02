// Rich-media data source. Contributes the presentation tools always (they need
// no external service) and the image search tool only when at least one image
// resource is enabled or a read document supplied candidates.

import { Tool } from "@core/agent";
import type { ImageCandidate } from "@core/media";
import type { ImageSearchRegistry, ToolDocumentImageQuery } from "@application/ports";
import { DataSource, DataSourceDescriptor } from "@application/sources";
import { AnswerArtifactRegistry } from "./AnswerArtifactRegistry";
import { ImageSearchTool, PresentChartTool, PresentImageGalleryTool } from "./MediaTools";

export interface MediaSourceOptions {
  artifacts: AnswerArtifactRegistry;
  imageSearch?: ImageSearchRegistry;
  documentCandidates?: (
    request: ToolDocumentImageQuery,
  ) => Promise<ImageCandidate[]> | ImageCandidate[];
  available?: boolean;
}

export class MediaSource implements DataSource {
  readonly descriptor: DataSourceDescriptor;

  constructor(private readonly options: MediaSourceOptions) {
    this.descriptor = {
      id: "media",
      kind: "media",
      title: "Answer media",
      available: options.available ?? true,
    };
  }

  tools(): Tool[] {
    const artifacts = this.options.artifacts;
    const tools: Tool[] = [
      new PresentImageGalleryTool({ artifacts }),
      new PresentChartTool({ artifacts }),
    ];
    const imageSearchAvailable =
      (this.options.imageSearch?.enabledImageSources().length ?? 0) > 0 ||
      this.options.documentCandidates !== undefined;
    if (imageSearchAvailable) {
      tools.unshift(
        new ImageSearchTool({
          registry: this.options.imageSearch ?? { enabledImageSources: () => [] },
          artifacts,
          ...(this.options.documentCandidates
            ? { documentCandidates: this.options.documentCandidates }
            : {}),
        }),
      );
    }
    return tools;
  }
}
