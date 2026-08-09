// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "obsidian";

import { createTranslator } from "@adapters/i18n";
import { ImageLightboxModal } from "@apps/obsidian/ui/chat/artifacts/ImageLightboxModal";
import type { AnswerImage } from "@core/media";
import type { DocumentImageResolver } from "@application/ports";
import { createContainer, resetDom } from "../../helpers/domHarness";
import { trackObjectUrls, type ObjectUrlTracker } from "../../helpers/objectUrls";

function embeddedImage(id: string): AnswerImage {
  return {
    id,
    alt: `Alt ${id}`,
    sourceUrl: "https://example.org/doc",
    sourceLabel: `notes/${id}.md`,
    vaultSource: { documentPath: `notes/${id}.md`, locator: `embedded-${id}` },
  };
}

const documentImages: DocumentImageResolver = {
  resolve: async () => ({
    data: new Uint8Array([1, 2, 3]),
    format: "png",
    width: 10,
    height: 10,
  }),
};

const t = createTranslator("en").t;

let tracker: ObjectUrlTracker;

function openLightbox(images: AnswerImage[], startIndex = 0, returnFocusTo?: HTMLElement) {
  const modal = new ImageLightboxModal(new App(), {
    app: new App(),
    t,
    documentImages,
    images,
    startIndex,
    ...(returnFocusTo ? { returnFocusTo } : {}),
  });
  modal.open();
  return modal;
}

function pressKey(modal: ImageLightboxModal, key: string): void {
  modal.modalEl.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  createContainer();
  tracker = trackObjectUrls();
});

afterEach(() => {
  tracker.restore();
  resetDom();
});

describe("image lightbox keyboard flow", () => {
  const images = [embeddedImage("a"), embeddedImage("b"), embeddedImage("c")];

  it("shows the image the caller opened on", async () => {
    const modal = openLightbox(images, 1);
    await settle();

    expect(modal.titleEl.textContent).toBe("Alt b");
    expect(modal.contentEl.querySelector(".ixplorer-lightbox__position")?.textContent).toBe(
      "2 of 3",
    );
  });

  it("moves forward and backward with the arrow keys", async () => {
    const modal = openLightbox(images, 0);
    await settle();

    pressKey(modal, "ArrowRight");
    await settle();
    expect(modal.titleEl.textContent).toBe("Alt b");

    pressKey(modal, "ArrowLeft");
    await settle();
    expect(modal.titleEl.textContent).toBe("Alt a");
  });

  it("wraps around at both ends", async () => {
    const modal = openLightbox(images, 0);
    await settle();

    pressKey(modal, "ArrowLeft");
    await settle();
    expect(modal.contentEl.querySelector(".ixplorer-lightbox__position")?.textContent).toBe(
      "3 of 3",
    );

    pressKey(modal, "ArrowRight");
    await settle();
    expect(modal.contentEl.querySelector(".ixplorer-lightbox__position")?.textContent).toBe(
      "1 of 3",
    );
  });

  it("ignores arrow keys for a single image", async () => {
    const modal = openLightbox([embeddedImage("solo")], 0);
    await settle();

    pressKey(modal, "ArrowRight");
    await settle();

    expect(modal.titleEl.textContent).toBe("Alt solo");
    expect(modal.contentEl.querySelector(".ixplorer-lightbox__nav")).toBeNull();
  });

  it("restores focus to the trigger that opened it", async () => {
    const trigger = document.body.appendChild(document.createElement("button"));
    const other = document.body.appendChild(document.createElement("button"));
    other.focus();

    const modal = openLightbox(images, 0, trigger);
    await settle();
    modal.close();

    expect(document.activeElement).toBe(trigger);
  });
});

describe("image lightbox object-url lifetime", () => {
  const images = [embeddedImage("a"), embeddedImage("b")];

  it("releases the previous object URL when navigating", async () => {
    const modal = openLightbox(images, 0);
    await settle();
    expect(tracker.live()).toHaveLength(1);

    pressKey(modal, "ArrowRight");
    await settle();

    expect(tracker.created).toHaveLength(2);
    expect(tracker.live()).toHaveLength(1);
  });

  it("releases the last object URL on close", async () => {
    const modal = openLightbox(images, 0);
    await settle();
    modal.close();

    expect(tracker.live()).toHaveLength(0);
  });

  it("does not leak an object URL resolved after the modal closed", async () => {
    const modal = openLightbox(images, 0);
    modal.close();
    await settle();

    expect(tracker.live()).toHaveLength(0);
    expect(modal.contentEl.querySelector("img")).toBeNull();
  });
});
