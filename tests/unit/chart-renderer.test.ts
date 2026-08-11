// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTranslator } from "@adapters/i18n";
import type { ChartArtifact } from "@core/media";
import { renderChartArtifact } from "@apps/obsidian/ui/chat/artifacts/chartRenderer";
import { installObsidianDomHelpers, resetDom } from "../helpers/domHarness";

const t = createTranslator("en").t;

function chart(overrides: Partial<ChartArtifact>): ChartArtifact {
  return {
    type: "chart",
    id: "chart",
    title: "Monthly results",
    chartType: "line",
    xLabel: "Month",
    yLabel: "Count",
    caption: "Collected during the experiment.",
    series: [
      {
        name: "First",
        points: [
          { x: "January", y: 2 },
          { x: "A very long category", y: -1 },
        ],
      },
      {
        name: "Second",
        points: [
          { x: "January", y: 1 },
          { x: "A very long category", y: 4 },
        ],
      },
    ],
    ...overrides,
  };
}

describe("renderChartArtifact", () => {
  beforeEach(installObsidianDomHelpers);
  afterEach(resetDom);

  it("renders a labelled line chart with axes, polylines, markers, legend, and table", () => {
    const container = document.createElement("div");
    renderChartArtifact(container, chart({}), t);

    expect(container.querySelector("svg")?.getAttribute("aria-label")).toContain("Monthly results");
    expect(container.querySelectorAll("polyline")).toHaveLength(2);
    expect(container.querySelectorAll("circle, rect.attest-chart__marker")).toHaveLength(4);
    expect(container.querySelectorAll(".attest-chart__axis-label")).toHaveLength(2);
    expect(container.querySelectorAll(".attest-chart__legend-item")).toHaveLength(2);
    expect(container.querySelectorAll(".attest-chart__table tbody tr")).toHaveLength(2);
    expect(container.textContent).toContain("Collected during the experiment.");
  });

  it("renders grouped bars and pie slices with point-based legends", () => {
    const bars = document.createElement("div");
    renderChartArtifact(bars, chart({ chartType: "bar", caption: undefined }), t);
    expect(bars.querySelectorAll("rect.attest-chart__bar")).toHaveLength(4);
    expect(bars.querySelectorAll("polyline")).toHaveLength(0);

    const pie = document.createElement("div");
    renderChartArtifact(
      pie,
      chart({
        chartType: "pie",
        series: [
          {
            name: "Distribution",
            points: [
              { x: "Yes", y: 3 },
              { x: "No", y: 1 },
            ],
          },
        ],
      }),
      t,
    );
    expect(pie.querySelectorAll("path.attest-chart__slice")).toHaveLength(2);
    expect(pie.querySelectorAll("path title")[0]?.textContent).toContain("Yes: 3 (75%)");
    expect(
      Array.from(pie.querySelectorAll(".attest-chart__legend-item")).map(
        (item) => item.textContent,
      ),
    ).toEqual(["Yes", "No"]);
  });
});
