import { App } from "obsidian";

import type { AnswerImage, ImageGalleryArtifact } from "@core/media";
import type { DocumentImageResolver } from "@application/ports";
import type { Translate } from "@adapters/i18n";
import type { TextDirection } from "@core/i18n";
import { attributionText } from "./imageAttribution";
import { ImageLightboxModal, renderSourceLink, renderUnavailable } from "./ImageLightboxModal";
import { resolveAnswerImageSource } from "./imageSourceResolver";

export interface GalleryRenderOptions {
  app: App;
  t: Translate;
  getDirection?: () => TextDirection;
  documentImages?: DocumentImageResolver;
}

const revokersByGallery = new WeakMap<HTMLElement, Array<() => void>>();

export function renderImageGalleryArtifact(
  containerEl: HTMLElement,
  gallery: ImageGalleryArtifact,
  options: GalleryRenderOptions,
): void {
  const section = containerEl.createEl("figure", {
    cls: "attest-artifact attest-gallery",
    attr: { role: "group", "aria-label": gallery.title ?? options.t("chat.artifact.gallery.aria") },
  });
  if (gallery.title) {
    section.createEl("figcaption", { cls: "attest-artifact__title", text: gallery.title });
  }

  const grid = section.createDiv({
    cls: `attest-gallery__grid is-count-${gallery.images.length}`,
  });
  const revokers: Array<() => void> = [];
  revokersByGallery.set(section, revokers);

  gallery.images.forEach((image, index) => {
    renderCard(grid, image, index, gallery, options, revokers);
  });
}

/** Releases object URLs created for embedded document images. */
export function disposeGalleryArtifacts(containerEl: HTMLElement): void {
  for (const section of Array.from(containerEl.querySelectorAll<HTMLElement>(".attest-gallery"))) {
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
  const card = grid.createDiv({ cls: "attest-gallery__card" });
  const trigger = card.createEl("button", {
    cls: "attest-gallery__trigger",
    attr: {
      type: "button",
      "aria-label": options.t("chat.artifact.image.open.aria", {
        name: image.alt || image.sourceLabel,
      }),
    },
  });
  trigger.addEventListener("click", () => {
    new ImageLightboxModal(options.app, {
      app: options.app,
      t: options.t,
      getDirection: options.getDirection,
      ...(options.documentImages ? { documentImages: options.documentImages } : {}),
      images: gallery.images,
      startIndex: index,
      returnFocusTo: trigger,
    }).open();
  });

  const meta = card.createDiv({ cls: "attest-gallery__meta" });
  meta.createDiv({ cls: "attest-gallery__alt", text: image.alt || image.sourceLabel });
  meta.createDiv({
    cls: "attest-artifact__attribution",
    text: attributionText(image, options.t),
  });
  renderSourceLink(meta, image, options.t);

  void resolveAnswerImageSource(image, options, true).then((resolved) => {
    if (!trigger.isConnected) {
      resolved?.revoke?.();
      return;
    }
    if (!resolved) {
      trigger.disabled = true;
      renderUnavailable(trigger, image, options.t);
      return;
    }
    if (resolved.revoke) revokers.push(resolved.revoke);
    const img = trigger.createEl("img", {
      cls: "attest-gallery__image",
      attr: { src: resolved.src, alt: image.alt, loading: "lazy", referrerpolicy: "no-referrer" },
    });
    img.addEventListener("error", () => {
      img.remove();
      trigger.disabled = true;
      renderUnavailable(trigger, image, options.t);
    });
  });
}
