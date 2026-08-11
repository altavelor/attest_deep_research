import { chartDataTable, formatNumber, type ChartArtifact, type ChartSeries } from "@core/media";
import type { Translate } from "@adapters/i18n";
import {
  buildChartScale,
  CHART_VIEWPORT,
  pieSlices,
  SERIES_DASHES,
  SERIES_SHAPES,
  seriesPolyline,
  type ChartScale,
} from "./chartGeometry";

const SVG_NS = "http://www.w3.org/2000/svg";
const MAX_AXIS_LABELS = 12;

export function renderChartArtifact(
  containerEl: HTMLElement,
  chart: ChartArtifact,
  t: Translate,
): void {
  const figure = containerEl.createEl("figure", { cls: "attest-artifact attest-chart" });
  figure.createEl("figcaption", { cls: "attest-artifact__title", text: chart.title });

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${CHART_VIEWPORT.width} ${CHART_VIEWPORT.height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("class", "attest-chart__svg");
  svg.setAttribute("aria-label", chartAriaLabel(chart, t));
  figure.appendChild(svg);

  if (chart.chartType === "pie") {
    renderPie(svg, chart);
  } else {
    renderCartesian(svg, chart);
  }

  renderLegend(figure, chart);

  if (chart.caption) {
    figure.createDiv({ cls: "attest-artifact__caption", text: chart.caption });
  }

  const details = figure.createEl("details", { cls: "attest-chart__data" });
  details.createEl("summary", { text: t("chat.artifact.chart.data") });
  renderDataTable(details, chart);
}

function chartAriaLabel(chart: ChartArtifact, t: Translate): string {
  return t("chat.artifact.chart.aria", {
    type: chart.chartType,
    title: chart.title,
    series: chart.series.map((series) => series.name).join(", "),
  });
}

function renderCartesian(svg: SVGSVGElement, chart: ChartArtifact): void {
  const scale = buildChartScale(chart);
  renderAxes(svg, chart, scale);

  chart.series.forEach((series, seriesIndex) => {
    const group = element(svg, "g", {
      class: `attest-chart__series is-series-${seriesIndex % 4}`,
    });
    if (chart.chartType === "bar") {
      renderBars(group, series, seriesIndex, chart.series.length, scale);
      return;
    }
    if (chart.chartType === "line") {
      const line = element(group, "polyline", {
        class: "attest-chart__line",
        points: seriesPolyline(series, scale),
        fill: "none",
        "stroke-dasharray": SERIES_DASHES[seriesIndex % SERIES_DASHES.length]!,
      });
      line.setAttribute("stroke-width", "2");
    }
    renderMarkers(group, series, seriesIndex, scale);
  });
}

function renderAxes(svg: SVGSVGElement, chart: ChartArtifact, scale: ChartScale): void {
  const axes = element(svg, "g", { class: "attest-chart__axes", "aria-hidden": "true" });
  element(axes, "line", {
    x1: String(scale.plot.x),
    y1: String(scale.plot.y + scale.plot.height),
    x2: String(scale.plot.x + scale.plot.width),
    y2: String(scale.plot.y + scale.plot.height),
  });
  element(axes, "line", {
    x1: String(scale.plot.x),
    y1: String(scale.plot.y),
    x2: String(scale.plot.x),
    y2: String(scale.plot.y + scale.plot.height),
  });

  for (const value of [scale.minY, (scale.minY + scale.maxY) / 2, scale.maxY]) {
    const label = element(axes, "text", {
      class: "attest-chart__tick",
      x: String(scale.plot.x - 8),
      y: String(scale.yFor(value) + 4),
      "text-anchor": "end",
    });
    label.textContent = formatNumber(Number(value.toFixed(2)));
  }

  const step = Math.ceil(scale.categories.length / MAX_AXIS_LABELS);
  scale.categories.forEach((category, index) => {
    if (index % step !== 0) return;
    const label = element(axes, "text", {
      class: "attest-chart__tick",
      x: String(scale.xFor(index)),
      y: String(scale.plot.y + scale.plot.height + 18),
      "text-anchor": "middle",
    });
    label.textContent = category.length > 12 ? `${category.slice(0, 11)}…` : category;
  });

  if (chart.xLabel) {
    const label = element(axes, "text", {
      class: "attest-chart__axis-label",
      x: String(scale.plot.x + scale.plot.width / 2),
      y: String(CHART_VIEWPORT.height - 6),
      "text-anchor": "middle",
    });
    label.textContent = chart.xLabel;
  }
  if (chart.yLabel) {
    const label = element(axes, "text", {
      class: "attest-chart__axis-label",
      x: String(-(scale.plot.y + scale.plot.height / 2)),
      y: "14",
      transform: "rotate(-90)",
      "text-anchor": "middle",
    });
    label.textContent = chart.yLabel;
  }
}

function renderBars(
  group: SVGElement,
  series: ChartSeries,
  seriesIndex: number,
  seriesCount: number,
  scale: ChartScale,
): void {
  const slot = (scale.bandWidth * 0.8) / seriesCount;
  const baseline = scale.yFor(Math.max(0, scale.minY));

  for (const point of series.points) {
    const centre = scale.xForPoint(point);
    if (centre === undefined) continue;
    const y = scale.yFor(point.y);
    element(group, "rect", {
      class: "attest-chart__bar",
      x: String(centre - scale.bandWidth * 0.4 + slot * seriesIndex),
      y: String(Math.min(y, baseline)),
      width: String(Math.max(1, slot - 2)),
      height: String(Math.max(1, Math.abs(baseline - y))),
    });
  }
}

/** Markers carry a per-series shape so series stay distinguishable without colour. */
function renderMarkers(
  group: SVGElement,
  series: ChartSeries,
  seriesIndex: number,
  scale: ChartScale,
): void {
  const shape = SERIES_SHAPES[seriesIndex % SERIES_SHAPES.length];
  for (const point of series.points) {
    const x = scale.xForPoint(point);
    if (x === undefined) continue;
    const y = scale.yFor(point.y);
    if (shape === "circle") {
      element(group, "circle", {
        class: "attest-chart__marker",
        cx: String(x),
        cy: String(y),
        r: "4",
      });
    } else if (shape === "square") {
      element(group, "rect", {
        class: "attest-chart__marker",
        x: String(x - 4),
        y: String(y - 4),
        width: "8",
        height: "8",
      });
    } else {
      const points =
        shape === "triangle"
          ? `${x},${y - 5} ${x + 5},${y + 4} ${x - 5},${y + 4}`
          : `${x},${y - 5} ${x + 5},${y} ${x},${y + 5} ${x - 5},${y}`;
      element(group, "polygon", { class: "attest-chart__marker", points });
    }
  }
}

function renderPie(svg: SVGSVGElement, chart: ChartArtifact): void {
  const slices = pieSlices(chart.series[0]!);
  slices.forEach((slice, index) => {
    const path = element(svg, "path", {
      class: `attest-chart__slice is-series-${index % 4}`,
      d: slice.path,
    });
    const title = element(path, "title", {});
    title.textContent = `${slice.label}: ${formatNumber(slice.value)} (${Math.round(slice.fraction * 100)}%)`;
  });
}

function renderLegend(figure: HTMLElement, chart: ChartArtifact): void {
  const legend = figure.createEl("ul", { cls: "attest-chart__legend" });
  const items =
    chart.chartType === "pie"
      ? chart.series[0]!.points.map((point) => String(point.x))
      : chart.series.map((series) => series.name);

  items.forEach((label, index) => {
    const item = legend.createEl("li", {
      cls: `attest-chart__legend-item is-series-${index % 4}`,
    });
    item.createSpan({
      cls: `attest-chart__legend-swatch is-${chart.chartType === "pie" ? "circle" : SERIES_SHAPES[index % SERIES_SHAPES.length]}`,
      attr: { "aria-hidden": "true" },
    });
    item.createSpan({ text: label });
  });
}

/** The text equivalent of the figure; also what the note export writes. */
function renderDataTable(containerEl: HTMLElement, chart: ChartArtifact): void {
  const rows = chartDataTable(chart)
    .split("\n")
    .filter((_, index) => index !== 1)
    .map((row) =>
      row
        .slice(1, -1)
        .split(" | ")
        .map((cell) => cell.trim().replace(/\\\|/g, "|")),
    );
  const table = containerEl.createEl("table", { cls: "attest-chart__table" });
  const head = table.createEl("thead").createEl("tr");
  for (const cell of rows[0] ?? []) head.createEl("th", { text: cell });
  const body = table.createEl("tbody");
  for (const row of rows.slice(1)) {
    const tr = body.createEl("tr");
    for (const cell of row) tr.createEl("td", { text: cell });
  }
}

function element<T extends SVGElement>(
  parent: SVGElement,
  tag: string,
  attributes: Record<string, string>,
): T {
  const node = document.createElementNS(SVG_NS, tag) as T;
  for (const [name, value] of Object.entries(attributes)) {
    node.setAttribute(name, value);
  }
  parent.appendChild(node);
  return node;
}
