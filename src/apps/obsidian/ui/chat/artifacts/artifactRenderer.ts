// Appends the answer's artifacts after the streamed Markdown. Artifacts are
// re-validated here so a saved chat written by an older or malformed source can
// never inject anything the contract forbids.

import { App } from "obsidian";

import { sanitizeAnswerArtifacts, type AnswerArtifact } from "@core/media";
import type { DocumentImageResolver } from "@application/ports";
import { renderChartArtifact } from "./chartRenderer";
import { disposeGalleryArtifacts, renderImageGalleryArtifact } from "./imageGalleryRenderer";

export interface ArtifactRenderOptions {
  app: App;
  documentImages?: DocumentImageResolver;
}

export function renderAnswerArtifacts(
  containerEl: HTMLElement,
  artifacts: readonly AnswerArtifact[] | undefined,
  options: ArtifactRenderOptions,
): boolean {
  const safe = sanitizeAnswerArtifacts(artifacts);
  if (!safe) return false;

  const listEl = containerEl.createDiv({ cls: "ixplorer-artifacts" });
  for (const artifact of safe) {
    if (artifact.type === "image-gallery") {
      renderImageGalleryArtifact(listEl, artifact, options);
    } else {
      renderChartArtifact(listEl, artifact);
    }
  }
  return true;
}

/** Releases resources the artifacts allocated (object URLs for embedded images). */
export function disposeAnswerArtifacts(containerEl: HTMLElement): void {
  disposeGalleryArtifacts(containerEl);
}
