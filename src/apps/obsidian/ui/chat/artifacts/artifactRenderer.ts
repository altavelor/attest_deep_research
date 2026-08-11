import { App } from "obsidian";

import { sanitizeAnswerArtifacts, type AnswerArtifact } from "@core/media";
import type { DocumentImageResolver } from "@application/ports";
import type { Translate } from "@adapters/i18n";
import type { TextDirection } from "@core/i18n";
import { renderChartArtifact } from "./chartRenderer";
import { disposeGalleryArtifacts, renderImageGalleryArtifact } from "./imageGalleryRenderer";

export interface ArtifactRenderOptions {
  app: App;
  t: Translate;
  getDirection?(): TextDirection;
  documentImages?: DocumentImageResolver;
}

export function renderAnswerArtifacts(
  containerEl: HTMLElement,
  artifacts: readonly AnswerArtifact[] | undefined,
  options: ArtifactRenderOptions,
): boolean {
  const safe = sanitizeAnswerArtifacts(artifacts);
  if (!safe) return false;

  const listEl = containerEl.createDiv({ cls: "attest-artifacts" });
  for (const artifact of safe) {
    if (artifact.type === "image-gallery") {
      renderImageGalleryArtifact(listEl, artifact, options);
    } else {
      renderChartArtifact(listEl, artifact, options.t);
    }
  }
  return true;
}

/** Releases resources the artifacts allocated (object URLs for embedded images). */
export function disposeAnswerArtifacts(containerEl: HTMLElement): void {
  disposeGalleryArtifacts(containerEl);
}
