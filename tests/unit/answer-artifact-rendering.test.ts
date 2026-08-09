import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

import { createTranslator } from "@adapters/i18n";
import { readStyles } from "../helpers/readStyles";
import {
  buildChartScale,
  chartCategories,
  CHART_VIEWPORT,
  pieSlices,
  SERIES_SHAPES,
  seriesPolyline,
} from "@apps/obsidian/ui/chat/artifacts/chartGeometry";
import {
  attributionText,
  isPageReference,
} from "@apps/obsidian/ui/chat/artifacts/imageAttribution";
import type { AnswerImage, ChartArtifact } from "@core/media";

const styles = readStyles();
const t = createTranslator("en").t;

const barChart: ChartArtifact = {
  type: "chart",
  id: "c1",
  title: "Revenue",
  chartType: "bar",
  series: [
    {
      name: "2025",
      points: [
        { x: "Q1", y: 10 },
        { x: "Q2", y: 30 },
      ],
    },
    { name: "2026", points: [{ x: "Q2", y: 20 }] },
  ],
};

describe("chart geometry", () => {
  it("collects categories across series in first-seen order", () => {
    expect(chartCategories(barChart)).toEqual(["Q1", "Q2"]);
  });

  it("maps values inside the plot area with the baseline at the bottom", () => {
    const scale = buildChartScale(barChart);
    expect(scale.yFor(0)).toBeCloseTo(scale.plot.y + scale.plot.height, 5);
    expect(scale.yFor(30)).toBeLessThan(scale.yFor(10));
    expect(scale.xFor(0)).toBeGreaterThanOrEqual(scale.plot.x);
    expect(scale.xFor(1)).toBeLessThanOrEqual(scale.plot.x + scale.plot.width);
  });

  it("emits one polyline point per series point", () => {
    const scale = buildChartScale(barChart);
    expect(seriesPolyline(barChart.series[0]!, scale).split(" ")).toHaveLength(2);
  });

  it("builds pie slices that cover the whole circle", () => {
    const slices = pieSlices({
      name: "share",
      points: [
        { x: "A", y: 3 },
        { x: "B", y: 1 },
      ],
    });
    expect(slices.map((slice) => slice.fraction)).toEqual([0.75, 0.25]);
    expect(slices.every((slice) => slice.path.startsWith("M "))).toBe(true);
    expect(CHART_VIEWPORT.width).toBeGreaterThan(0);
  });

  it("places numeric scatter points by magnitude, not by category order", () => {
    const scatter: ChartArtifact = {
      type: "chart",
      id: "c2",
      title: "Spread",
      chartType: "scatter",
      series: [
        {
          name: "s",
          points: [
            { x: 0, y: 1 },
            { x: 1, y: 2 },
            { x: 100, y: 3 },
          ],
        },
      ],
    };
    const scale = buildChartScale(scatter);
    expect(scale.numericX).toBe(true);
    const [first, second, third] = scatter.series[0]!.points.map(
      (point) => scale.xForPoint(point)!,
    );
    expect(third! - second!).toBeGreaterThan((second! - first!) * 10);
    expect(first).toBeCloseTo(scale.plot.x, 5);
    expect(third).toBeCloseTo(scale.plot.x + scale.plot.width, 5);
  });

  it("keeps categorical spacing for non-scatter charts and string x values", () => {
    const scale = buildChartScale(barChart);
    expect(scale.numericX).toBe(false);
    expect(scale.xForPoint({ x: "Q2", y: 1 })).toBeCloseTo(scale.xFor(1), 5);
    expect(scale.xForPoint({ x: "Q9", y: 1 })).toBeUndefined();
  });

  it("gives each series a distinct marker shape so colour is not the only cue", () => {
    expect(new Set(SERIES_SHAPES).size).toBe(SERIES_SHAPES.length);
  });
});

describe("image attribution", () => {
  const base: AnswerImage = {
    id: "i1",
    fullUrl: "https://example.com/a.png",
    alt: "Alt",
    sourceUrl: "https://example.com/page",
    sourceLabel: "Example page",
  };

  it("never describes a plain page reference as licensed content", () => {
    expect(isPageReference(base)).toBe(true);
    expect(attributionText(base, t)).toBe("Referenced from Example page");
    expect(attributionText(base, t)).not.toMatch(/licen[cs]e/i);
  });

  it("shows provider licence metadata when the provider supplied it", () => {
    expect(
      attributionText(
        {
          ...base,
          sourceLabel: "Wikimedia Commons · Jane",
          licenceName: "CC BY-SA 4.0",
          licensed: true,
        },
        t,
      ),
    ).toBe("Wikimedia Commons · Jane · CC BY-SA 4.0");
  });

  it("attributes vault images to their document", () => {
    expect(
      attributionText(
        {
          ...base,
          fullUrl: undefined,
          vaultSource: { documentPath: "docs/a.pdf", locator: "page:1:0" },
          sourceLabel: "a.pdf",
        },
        t,
      ),
    ).toBe("From a.pdf");
  });
});

describe("artifact rendering contracts", () => {
  const rendererSources = [
    "src/apps/obsidian/ui/chat/artifacts/chartRenderer.ts",
    "src/apps/obsidian/ui/chat/artifacts/imageGalleryRenderer.ts",
    "src/apps/obsidian/ui/chat/artifacts/ImageLightboxModal.ts",
    "src/apps/obsidian/ui/chat/artifacts/artifactRenderer.ts",
  ].map((path) => ({ path, source: readFileSync(path, "utf8") }));

  it("never injects markup or inline styles from artifact data", () => {
    for (const { path, source } of rendererSources) {
      expect(source, path).not.toContain("innerHTML");
      expect(source, path).not.toContain("outerHTML");
      expect(source, path).not.toContain("insertAdjacentHTML");
      expect(source, path).not.toMatch(/setAttribute\(\s*"(style|on\w+)"/);
    }
  });

  it("re-validates artifacts before rendering a saved chat", () => {
    const renderer = rendererSources.find((entry) => entry.path.endsWith("artifactRenderer.ts"))!;
    expect(renderer.source).toContain("sanitizeAnswerArtifacts");
  });

  it("revokes object urls created for embedded document images", () => {
    const gallery = rendererSources.find((entry) =>
      entry.path.endsWith("imageGalleryRenderer.ts"),
    )!;
    expect(gallery.source).toContain("disposeGalleryArtifacts");
    expect(
      readFileSync("src/apps/obsidian/ui/chat/artifacts/imageSourceResolver.ts", "utf8"),
    ).toContain("revokeObjectURL");
    expect(readFileSync("src/apps/obsidian/ui/chat/assistantMessageRenderer.ts", "utf8")).toContain(
      "disposeAnswerArtifacts",
    );
  });

  it("disposes artifacts before the whole transcript is re-rendered", () => {
    const transcript = readFileSync("src/apps/obsidian/ui/chat/ChatTranscript.ts", "utf8");
    expect(transcript).toContain("disposeAnswerArtifacts(transcriptEl)");
    const disposeAt = transcript.indexOf("disposeChatTranscript(transcriptEl)");
    const emptyAt = transcript.indexOf("transcriptEl.empty()");
    expect(disposeAt).toBeGreaterThan(-1);
    expect(disposeAt).toBeLessThan(emptyAt);
  });

  it("keeps the lightbox keyboard-accessible and restores focus", () => {
    const lightbox = rendererSources.find((entry) =>
      entry.path.endsWith("ImageLightboxModal.ts"),
    )!.source;
    expect(lightbox).toContain('this.scope.register([], "ArrowRight"');
    expect(lightbox).toContain('this.scope.register([], "ArrowLeft"');
    expect(lightbox).toContain("returnFocusTo?.focus()");
  });

  it("labels the chart for screen readers and offers the data table", () => {
    const chart = rendererSources.find((entry) => entry.path.endsWith("chartRenderer.ts"))!.source;
    expect(chart).toContain('svg.setAttribute("role", "img")');
    expect(chart).toContain('svg.setAttribute("aria-label"');
    expect(chart).toContain("chartDataTable");
  });
});

describe("artifact styles", () => {
  it("scrolls wide answer tables instead of overflowing the chat pane", () => {
    expect(cssRule(".ixplorer-chat__answer-content table")).toContain("overflow-x: auto");
    expect(cssRule(".ixplorer-chat__answer-content table")).toContain("max-width: 100%");
  });

  it("sizes the full-screen viewer at three quarters of the viewport", () => {
    const modal = cssRule(".modal.ixplorer-lightbox");
    expect(modal).toContain("width: 75vw");
    expect(modal).toContain("height: 75vh");
    expect(modal).toContain("max-width: 75vw");
    expect(modal).toContain("max-height: 75vh");
  });

  it("lets the viewer image fill the space the caption does not need", () => {
    expect(cssRule(".ixplorer-lightbox .ixplorer-lightbox__stage")).toContain("flex: 1 1 auto");
    const image = cssRule(".ixplorer-lightbox__image");
    expect(image).toContain("max-height: 100%");
    expect(image).toContain("object-fit: contain");
  });

  it("keeps gallery focus rings visible for keyboard users", () => {
    expect(cssRule(".ixplorer-gallery__trigger:focus-visible")).toContain("outline");
  });

  it("never lets an artifact widen the chat pane", () => {
    for (const selector of [
      ".ixplorer-chat__answer-content",
      ".ixplorer-artifacts",
      ".ixplorer-artifact",
      ".ixplorer-gallery__grid",
    ]) {
      expect(cssRule(selector), selector).toContain("min-width: 0");
      expect(cssRule(selector), selector).toContain("max-width: 100%");
    }
  });

  it("wraps gallery cards onto several rows instead of one shrinking row", () => {
    const grid = cssRule(".ixplorer-gallery__grid");
    expect(grid).toContain("auto-fill");
    expect(grid).toContain("min(190px, 100%)");
  });

  it("gives thumbnails a readable height", () => {
    const image = cssRule(".ixplorer-gallery__image");
    expect(image).toContain("aspect-ratio: 4 / 3");
    expect(image).toContain("min-height: 160px");
  });
});

function cssRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(styles)?.[1] ?? "";
}
