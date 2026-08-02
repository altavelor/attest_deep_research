import { App, Modal, setIcon } from "obsidian";

import type { AnswerImage } from "@core/media";
import { attributionText, isPageReference } from "./imageAttribution";
import { resolveAnswerImageSource, type ImageSourceResolverOptions } from "./imageSourceResolver";

export interface ImageLightboxOptions extends ImageSourceResolverOptions {
  images: AnswerImage[];
  startIndex: number;

  returnFocusTo?: HTMLElement;
}

export class ImageLightboxModal extends Modal {
  private index: number;
  private revokeCurrent?: () => void;

  private renderGeneration = 0;
  private closed = false;

  constructor(
    app: App,
    private readonly options: ImageLightboxOptions,
  ) {
    super(app);
    this.index = Math.min(Math.max(options.startIndex, 0), options.images.length - 1);
  }

  onOpen(): void {
    this.closed = false;
    this.modalEl.addClass("ixplorer-lightbox");
    this.scope.register([], "ArrowRight", () => {
      this.step(1);
      return false;
    });
    this.scope.register([], "ArrowLeft", () => {
      this.step(-1);
      return false;
    });
    void this.renderCurrent();
  }

  onClose(): void {
    this.closed = true;
    this.renderGeneration += 1;
    this.releaseCurrent();
    this.contentEl.empty();
    this.options.returnFocusTo?.focus();
  }

  private step(delta: number): void {
    if (this.options.images.length < 2) return;
    const count = this.options.images.length;
    this.index = (this.index + delta + count) % count;
    void this.renderCurrent();
  }

  private releaseCurrent(): void {
    this.revokeCurrent?.();
    this.revokeCurrent = undefined;
  }

  private async renderCurrent(): Promise<void> {
    const image = this.options.images[this.index];
    if (!image || this.closed) return;

    this.renderGeneration += 1;
    const generation = this.renderGeneration;
    this.releaseCurrent();
    const { contentEl } = this;
    contentEl.empty();
    this.titleEl.setText(image.alt || image.sourceLabel);

    const stage = contentEl.createDiv({ cls: "ixplorer-lightbox__stage" });
    const resolved = await resolveAnswerImageSource(image, this.options, false);
    if (this.closed || generation !== this.renderGeneration) {
      resolved?.revoke?.();
      return;
    }
    if (resolved) {
      this.revokeCurrent = resolved.revoke;
      const img = stage.createEl("img", {
        cls: "ixplorer-lightbox__image",
        attr: { src: resolved.src, alt: image.alt },
      });
      img.addEventListener("error", () => {
        img.remove();
        renderUnavailable(stage, image);
      });
    } else {
      renderUnavailable(stage, image);
    }

    if (this.options.images.length > 1) {
      this.renderNavigation(stage);
    }

    const footer = contentEl.createDiv({ cls: "ixplorer-lightbox__footer" });
    if (image.caption) {
      footer.createDiv({ cls: "ixplorer-artifact__caption", text: image.caption });
    }
    footer.createDiv({ cls: "ixplorer-artifact__attribution", text: attributionText(image) });
    renderSourceLink(footer, image);
    footer.createDiv({
      cls: "ixplorer-lightbox__position",
      text: `${this.index + 1} of ${this.options.images.length}`,
    });
  }

  private renderNavigation(stage: HTMLElement): void {
    const previous = stage.createEl("button", {
      cls: "ixplorer-lightbox__nav is-previous",
      attr: { type: "button", "aria-label": "Previous image" },
    });
    setIcon(previous, "chevron-left");
    previous.addEventListener("click", () => this.step(-1));

    const next = stage.createEl("button", {
      cls: "ixplorer-lightbox__nav is-next",
      attr: { type: "button", "aria-label": "Next image" },
    });
    setIcon(next, "chevron-right");
    next.addEventListener("click", () => this.step(1));
  }
}

export function renderUnavailable(containerEl: HTMLElement, image: AnswerImage): void {
  const fallback = containerEl.createDiv({ cls: "ixplorer-artifact__unavailable" });
  const icon = fallback.createSpan({ attr: { "aria-hidden": "true" } });
  setIcon(icon, "image-off");
  fallback.createSpan({
    text: image.vaultSource ? "Image unavailable" : "Image could not be loaded",
  });
}

export function renderSourceLink(containerEl: HTMLElement, image: AnswerImage): void {
  const label = isPageReference(image) ? "Open source" : "Open source page";
  if (image.vaultSource && !/^https?:/i.test(image.sourceUrl)) {
    containerEl.createEl("a", {
      cls: "ixplorer-artifact__source internal-link",
      text: `Open ${image.sourceLabel}`,
      attr: { href: image.sourceUrl, "data-href": image.sourceUrl },
    });
    return;
  }
  containerEl.createEl("a", {
    cls: "ixplorer-artifact__source",
    text: label,
    attr: { href: image.sourceUrl, target: "_blank", rel: "noopener noreferrer" },
  });
}
