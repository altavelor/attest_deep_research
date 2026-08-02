// Pure geometry for the answer charts. Keeping the maths out of the renderer
// keeps the DOM code thin and lets the layout be tested without a document.

import type { ChartArtifact, ChartPoint, ChartSeries } from "@core/media";

export const CHART_VIEWPORT = {
  width: 640,
  height: 320,
  padding: { top: 16, right: 16, bottom: 44, left: 56 },
} as const;

export interface ChartScale {
  categories: string[];
  minY: number;
  maxY: number;
  plot: { x: number; y: number; width: number; height: number };
  /** Horizontal centre of a category slot. */
  xFor(categoryIndex: number): number;
  /** Horizontal position of a point; undefined when its category is unknown. */
  xForPoint(point: ChartPoint): number | undefined;
  yFor(value: number): number;
  bandWidth: number;
  /** True when x is plotted by magnitude rather than by category order. */
  numericX: boolean;
}

export function chartCategories(chart: ChartArtifact): string[] {
  const categories: string[] = [];
  for (const series of chart.series) {
    for (const point of series.points) {
      const label = String(point.x);
      if (!categories.includes(label)) categories.push(label);
    }
  }
  if (hasNumericXDomain(chart)) {
    categories.sort((left, right) => Number(left) - Number(right));
  }
  return categories;
}

/**
 * Scatter points with purely numeric x are quantitative, so they are placed by
 * magnitude; every other chart keeps evenly spaced category bands.
 */
export function hasNumericXDomain(chart: ChartArtifact): boolean {
  return (
    chart.chartType === "scatter" &&
    chart.series.every((series) => series.points.every((point) => typeof point.x === "number"))
  );
}

export function buildChartScale(chart: ChartArtifact): ChartScale {
  const categories = chartCategories(chart);
  const numericX = hasNumericXDomain(chart);
  const xValues = numericX ? categories.map(Number) : [];
  const minX = numericX ? Math.min(...xValues) : 0;
  const maxX = numericX ? Math.max(...xValues) : 0;
  const xSpan = maxX - minX;
  const values = chart.series.flatMap((series) => series.points.map((point) => point.y));
  const rawMin = Math.min(0, ...values);
  const rawMax = Math.max(0, ...values);
  const span = rawMax - rawMin || 1;
  const minY = rawMin === 0 ? 0 : rawMin - span * 0.05;
  const maxY = rawMax + span * 0.05;

  const plot = {
    x: CHART_VIEWPORT.padding.left,
    y: CHART_VIEWPORT.padding.top,
    width: CHART_VIEWPORT.width - CHART_VIEWPORT.padding.left - CHART_VIEWPORT.padding.right,
    height: CHART_VIEWPORT.height - CHART_VIEWPORT.padding.top - CHART_VIEWPORT.padding.bottom,
  };
  const bandWidth = plot.width / Math.max(1, categories.length);
  const xForValue = (value: number): number =>
    xSpan === 0 ? plot.x + plot.width / 2 : plot.x + ((value - minX) / xSpan) * plot.width;
  const xFor = (categoryIndex: number): number =>
    numericX
      ? xForValue(Number(categories[categoryIndex] ?? minX))
      : plot.x + bandWidth * (categoryIndex + 0.5);

  return {
    categories,
    minY,
    maxY,
    plot,
    bandWidth,
    numericX,
    xFor,
    xForPoint: (point) => {
      if (numericX) {
        return typeof point.x === "number" ? xForValue(point.x) : undefined;
      }
      const index = categories.indexOf(String(point.x));
      return index === -1 ? undefined : xFor(index);
    },
    yFor: (value) => plot.y + plot.height - ((value - minY) / (maxY - minY || 1)) * plot.height,
  };
}

export function seriesPolyline(series: ChartSeries, scale: ChartScale): string {
  return series.points
    .map((point) => {
      const x = scale.xForPoint(point) ?? scale.xFor(0);
      return `${x.toFixed(2)},${scale.yFor(point.y).toFixed(2)}`;
    })
    .join(" ");
}

export interface PieSlice {
  label: string;
  value: number;
  fraction: number;
  path: string;
}

/** Slices for a pie chart; assumes the series was already validated as drawable. */
export function pieSlices(series: ChartSeries): PieSlice[] {
  const total = series.points.reduce((sum, point) => sum + point.y, 0);
  const centreX = CHART_VIEWPORT.width / 2;
  const centreY = CHART_VIEWPORT.height / 2;
  const radius = Math.min(centreX, centreY) - CHART_VIEWPORT.padding.top;
  let angle = -Math.PI / 2;

  return series.points.map((point) => {
    const fraction = point.y / total;
    const sweep = fraction * Math.PI * 2;
    const endAngle = angle + sweep;
    const path =
      fraction >= 1
        ? `M ${centreX} ${centreY - radius} A ${radius} ${radius} 0 1 1 ${centreX - 0.01} ${centreY - radius} Z`
        : [
            `M ${centreX} ${centreY}`,
            `L ${(centreX + radius * Math.cos(angle)).toFixed(2)} ${(centreY + radius * Math.sin(angle)).toFixed(2)}`,
            `A ${radius} ${radius} 0 ${sweep > Math.PI ? 1 : 0} 1 ${(centreX + radius * Math.cos(endAngle)).toFixed(2)} ${(centreY + radius * Math.sin(endAngle)).toFixed(2)}`,
            "Z",
          ].join(" ");
    angle = endAngle;
    return { label: String(point.x), value: point.y, fraction, path };
  });
}

/** Distinct shapes so colour is never the only differentiator between series. */
export const SERIES_SHAPES = ["circle", "square", "triangle", "diamond"] as const;

export const SERIES_DASHES = ["", "6 3", "2 3", "10 3 2 3"] as const;
