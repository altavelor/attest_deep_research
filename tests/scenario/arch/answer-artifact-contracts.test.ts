import { readFileSync } from "node:fs";

import { readStyles } from "../../support/readStyles";

const styles = readStyles();
const read = (path: string): string => readFileSync(path, "utf8");

describe("artifact rendering contracts", () => {
  const rendererSources = [
    "src/apps/obsidian/ui/chat/artifacts/chartRenderer.ts",
    "src/apps/obsidian/ui/chat/artifacts/imageGalleryRenderer.ts",
    "src/apps/obsidian/ui/chat/artifacts/ImageLightboxModal.ts",
    "src/apps/obsidian/ui/chat/artifacts/artifactRenderer.ts",
  ].map((path) => ({ path, source: read(path) }));

  it("never injects markup or inline styles from artifact data", () => {
    for (const { path, source } of rendererSources) {
      expect(source, path).not.toContain("innerHTML");
      expect(source, path).not.toContain("outerHTML");
      expect(source, path).not.toContain("insertAdjacentHTML");
      expect(source, path).not.toMatch(/setAttribute\(\s*"(style|on\w+)"/);
    }
  });

  it("disposes artifacts before re-rendering and labels the chart for screen readers", () => {
    expect(read("src/apps/obsidian/ui/chat/assistantMessageRenderer.ts")).toContain(
      "disposeAnswerArtifacts",
    );
    const transcript = read("src/apps/obsidian/ui/chat/ChatTranscript.ts");
    expect(transcript).toContain("disposeAnswerArtifacts(transcriptEl)");
    const disposeAt = transcript.indexOf("disposeChatTranscript(transcriptEl)");
    const emptyAt = transcript.indexOf("transcriptEl.empty()");
    expect(disposeAt).toBeGreaterThan(-1);
    expect(disposeAt).toBeLessThan(emptyAt);

    const chart = read("src/apps/obsidian/ui/chat/artifacts/chartRenderer.ts");
    expect(chart).toContain('svg.setAttribute("role", "img")');
    expect(chart).toContain("chartDataTable");
  });
});

describe("artifact styles", () => {
  it("keeps tables, the viewer and the gallery inside the chat pane and readable", () => {
    expect(cssRule(".attest-chat__answer-content table")).toContain("overflow-x: auto");
    expect(cssRule(".attest-chat__answer-content table")).toContain("max-width: 100%");

    const modal = cssRule(".modal.attest-lightbox");
    expect(modal).toContain("width: 75vw");
    expect(modal).toContain("height: 75vh");
    expect(modal).toContain("max-width: 75vw");
    expect(modal).toContain("max-height: 75vh");

    expect(cssRule(".attest-lightbox .attest-lightbox__stage")).toContain("flex: 1 1 auto");
    const image = cssRule(".attest-lightbox__image");
    expect(image).toContain("max-height: 100%");
    expect(image).toContain("object-fit: contain");

    expect(cssRule(".attest-gallery__trigger:focus-visible")).toContain("outline");

    for (const selector of [
      ".attest-chat__answer-content",
      ".attest-artifacts",
      ".attest-artifact",
      ".attest-gallery__grid",
    ]) {
      expect(cssRule(selector), selector).toContain("min-width: 0");
      expect(cssRule(selector), selector).toContain("max-width: 100%");
    }

    const grid = cssRule(".attest-gallery__grid");
    expect(grid).toContain("auto-fill");
    expect(grid).toContain("min(190px, 100%)");

    const thumbnail = cssRule(".attest-gallery__image");
    expect(thumbnail).toContain("aspect-ratio: 4 / 3");
    expect(thumbnail).toContain("min-height: 160px");
  });
});

function cssRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(styles)?.[1] ?? "";
}
