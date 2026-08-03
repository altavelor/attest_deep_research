// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App, TFile } from "obsidian";

import {
  disposeAnswerArtifacts,
  renderAnswerArtifacts,
} from "@apps/obsidian/ui/chat/artifacts/artifactRenderer";
import type { AnswerArtifact } from "@core/media";
import type { DocumentImageResolver } from "@application/ports";
import { createContainer, resetDom } from "../../helpers/domHarness";
import { trackObjectUrls, type ObjectUrlTracker } from "../../helpers/objectUrls";

const documentImages: DocumentImageResolver = {
  resolve: async () => ({
    data: new Uint8Array([1, 2, 3]),
    format: "png",
    width: 10,
    height: 10,
  }),
};

function vaultApp(files: Record<string, TFile>): App {
  return {
    vault: {
      getAbstractFileByPath: (path: string) => files[path] ?? null,
      getResourcePath: (file: TFile) => `app://vault/${file.path}`,
    },
  } as unknown as App;
}

function gallery(images: unknown[]): AnswerArtifact {
  return { type: "image-gallery", id: "g1", title: "Figures", images } as AnswerArtifact;
}

const embeddedImage = {
  id: "embedded",
  alt: "Diagram",
  sourceUrl: "notes/report.md",
  sourceLabel: "report.md",
  vaultSource: { documentPath: "notes/report.md", locator: "img-1" },
};

let container: HTMLElement;
let tracker: ObjectUrlTracker;

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  container = createContainer();
  tracker = trackObjectUrls();
});

afterEach(() => {
  tracker.restore();
  resetDom();
});

describe("saved answer artifacts with untrusted content", () => {
  it("renders nothing for artifacts that fail validation", () => {
    const rendered = renderAnswerArtifacts(
      container,
      [
        gallery([
          {
            id: "javascript-source",
            alt: "Bad",
            sourceUrl: "javascript:alert(1)",
            sourceLabel: "evil",
            fullUrl: "https://example.org/a.png",
          },
        ]),
      ],
      { app: vaultApp({}) },
    );

    expect(rendered).toBe(false);
    expect(container.querySelector(".ixplorer-gallery")).toBeNull();
  });

  it("rejects a gallery holding a vault path that escapes the vault, keeping valid ones", () => {
    const escaping = {
      ...embeddedImage,
      id: "escaping",
      sourceUrl: "../../etc/passwd",
      vaultSource: { documentPath: "../../etc/passwd", locator: "img-1" },
    };
    const rendered = renderAnswerArtifacts(
      container,
      [
        { ...gallery([escaping]), id: "bad" },
        { ...gallery([embeddedImage]), id: "good", title: "Valid" },
      ],
      { app: vaultApp({}) },
    );

    expect(rendered).toBe(true);
    expect(container.querySelectorAll(".ixplorer-gallery")).toHaveLength(1);
    expect(container.querySelector(".ixplorer-artifact__title")?.textContent).toBe("Valid");
    expect(container.innerHTML).not.toContain("passwd");
  });

  it("keeps an untrusted alt text as text rather than markup", async () => {
    renderAnswerArtifacts(
      container,
      [
        gallery([
          {
            ...embeddedImage,
            alt: "<img src=x onerror=alert(1)>",
            sourceUrl: "https://example.org/page",
            fullUrl: "https://example.org/ok.png",
            vaultSource: undefined,
          },
        ]),
      ],
      { app: vaultApp({}) },
    );

    await settle();

    expect(container.querySelector(".ixplorer-gallery__alt")?.textContent).toBe(
      "<img src=x onerror=alert(1)>",
    );
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(container.querySelector("img")?.getAttribute("alt")).toBe(
      "<img src=x onerror=alert(1)>",
    );
    expect(container.querySelector("[onerror]")).toBeNull();
  });

  it("marks an unavailable vault image instead of rendering a broken picture", async () => {
    renderAnswerArtifacts(
      container,
      [
        gallery([
          { ...embeddedImage, vaultSource: { ...embeddedImage.vaultSource, locator: "file" } },
        ]),
      ],
      {
        app: vaultApp({}),
      },
    );
    await settle();

    const trigger = container.querySelector<HTMLButtonElement>(".ixplorer-gallery__trigger");
    expect(trigger?.disabled).toBe(true);
    expect(container.querySelector(".ixplorer-artifact__unavailable")).not.toBeNull();
  });

  it("serves a vault file image from its resource path without an object URL", async () => {
    const file = Object.assign(Object.create(TFile.prototype) as TFile, {
      path: "notes/report.md",
      stat: { size: 1, mtime: 2, ctime: 0 },
    });
    renderAnswerArtifacts(
      container,
      [
        gallery([
          { ...embeddedImage, vaultSource: { ...embeddedImage.vaultSource, locator: "file" } },
        ]),
      ],
      { app: vaultApp({ "notes/report.md": file }) },
    );
    await settle();

    expect(container.querySelector("img")?.getAttribute("src")).toBe("app://vault/notes/report.md");
    expect(tracker.created).toHaveLength(0);
  });
});

describe("answer artifact disposal", () => {
  it("revokes every object URL an embedded gallery created", async () => {
    renderAnswerArtifacts(
      container,
      [gallery([embeddedImage, { ...embeddedImage, id: "second" }])],
      {
        app: vaultApp({}),
        documentImages,
      },
    );
    await settle();

    expect(tracker.created).toHaveLength(2);
    expect(tracker.live()).toHaveLength(2);

    disposeAnswerArtifacts(container);

    expect(tracker.live()).toHaveLength(0);
  });

  it("revokes an object URL resolved after the gallery was detached", async () => {
    renderAnswerArtifacts(container, [gallery([embeddedImage])], {
      app: vaultApp({}),
      documentImages,
    });
    container.innerHTML = "";
    await settle();

    expect(tracker.live()).toHaveLength(0);
  });
});
