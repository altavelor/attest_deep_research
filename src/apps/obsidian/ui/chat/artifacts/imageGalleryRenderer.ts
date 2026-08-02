// Renders an image-gallery artifact as a row of 1–4 attributed cards. A card
// opens the full-size viewer; a card whose image cannot load degrades to an
// attribution-only fallback that still links to the source.

import { App } from "obsidian";

import type { AnswerImage, ImageGalleryArtifact } from "@core/media";
import type { DocumentImageResolver } from "@application/ports";
import { attributionText } from "./imageAttribution";
import { ImageLightboxModal, renderSourceLink, renderUnavailable } from "./ImageLightboxModal";
import { resolveAnswerImageSource } from "./imageSourceResolver";

export interface GalleryRenderOptions {
  app: App;
  documentImages?: DocumentImageResolver;
}

const revokersByGallery = new WeakMap<HTMLElement, Array<() => void>>();

export function renderImageGalleryArtifact(
  containerEl: HTMLElement,
  gallery: ImageGalleryArtifact,
  options: GalleryRenderOptions,
): void {
  const section = containerEl.createEl("figure", {
    cls: "ixplorer-artifact ixplorer-gallery",
    attr: { role: "group", "aria-label": gallery.title ?? "Images for this answer" },
  });
  if (gallery.title) {
    section.createEl("figcaption", { cls: "ixplorer-artifact__title", text: gallery.title });
  }

  const grid = section.createDiv({
    cls: `ixplorer-gallery__grid is-count-${gallery.images.length}`,
  });
  const revokers: Array<() => void> = [];
  revokersByGallery.set(section, revokers);

  gallery.images.forEach((image, index) => {
    renderCard(grid, image, index, gallery, options, revokers);
  });
}

/** Releases object URLs created for embedded document images. */
export function disposeGalleryArtifacts(containerEl: HTMLElement): void {
  for (const section of Array.from(
    containerEl.querySelectorAll<HTMLElement>(".ixplorer-gallery"),
  )) {
    for (const revoke of revokersByGallery.get(section) ?? []) revoke();
    revokersByGallery.delete(section);
  }
}

function renderCard(
  grid: HTMLElement,
  image: AnswerImage,
  index: number,
  gallery: ImageGalleryArtifact,
  options: GalleryRenderOptions,
  revokers: Array<() => void>,
): void {
  const card = grid.createDiv({ cls: "ixplorer-gallery__card" });
  const trigger = card.createEl("button", {
    cls: "ixplorer-gallery__trigger",
    attr: { type: "button", "aria-label": `Open image: ${image.alt || image.sourceLabel}` },
  });
  trigger.addEventListener("click", () => {
    new ImageLightboxModal(options.app, {
      app: options.app,
      ...(options.documentImages ? { documentImages: options.documentImages } : {}),
      images: gallery.images,
      startIndex: index,
      returnFocusTo: trigger,
    }).open();
  });

  const meta = card.createDiv({ cls: "ixplorer-gallery__meta" });
  meta.createDiv({ cls: "ixplorer-gallery__alt", text: image.alt || image.sourceLabel });
  meta.createDiv({ cls: "ixplorer-artifact__attribution", text: attributionText(image) });
  renderSourceLink(meta, image);

  void resolveAnswerImageSource(image, options, true).then((resolved) => {
    if (!trigger.isConnected) {
      resolved?.revoke?.();
      return;
    }
    if (!resolved) {
      trigger.disabled = true;
      renderUnavailable(trigger, image);
      return;
    }
    if (resolved.revoke) revokers.push(resolved.revoke);
    const img = trigger.createEl("img", {
      cls: "ixplorer-gallery__image",
      attr: { src: resolved.src, alt: image.alt, loading: "lazy", referrerpolicy: "no-referrer" },
    });
    img.addEventListener("error", () => {
      img.remove();
      trigger.disabled = true;
      renderUnavailable(trigger, image);
    });
  });
}
