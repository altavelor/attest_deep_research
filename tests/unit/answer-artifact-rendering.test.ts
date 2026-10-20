import { describe, expect, it } from "vitest";

import { createTranslator } from "@adapters/i18n";
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
    const [first, second, third] = scatter.series[0]!.points.map((point) =>
      scale.xForPoint(point)!,
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
