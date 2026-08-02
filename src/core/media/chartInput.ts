// Validation and text rendering for chart artifacts. The model supplies data
// only; every visual is produced locally, so nothing here accepts markup, URLs,
// styles, or handlers.

import {
  ARTIFACT_LIMITS,
  ChartArtifact,
  ChartSeries,
  ChartType,
  CHART_TYPES,
  isDrawablePie,
} from "./artifacts";

export type ChartValidation =
  | { ok: true; value: Omit<ChartArtifact, "id"> }
  | { ok: false; code: string; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed ? collapsed.slice(0, maxLength) : undefined;
}

/**
 * Validates untrusted chart arguments into a chart artifact body. Rejects
 * non-finite numbers, oversized series, and pie inputs that cannot be drawn.
 */
export function validateChartInput(input: Record<string, unknown>): ChartValidation {
  const title = boundedText(input.title, ARTIFACT_LIMITS.titleLength);
  if (!title) return fail("invalid-title", "title must be a non-empty string.");

  const chartType = typeof input.chartType === "string" ? input.chartType : "";
  if (!(CHART_TYPES as readonly string[]).includes(chartType)) {
    return fail("invalid-chart-type", `chartType must be one of ${CHART_TYPES.join(", ")}.`);
  }

  if (!Array.isArray(input.series) || input.series.length === 0) {
    return fail("invalid-series", "series must be a non-empty array.");
  }
  if (input.series.length > ARTIFACT_LIMITS.chartSeries) {
    return fail("too-many-series", `At most ${ARTIFACT_LIMITS.chartSeries} series are allowed.`);
  }

  const series: ChartSeries[] = [];
  const usedNames = new Set<string>();
  for (const raw of input.series) {
    const parsed = parseSeries(raw);
    if (!parsed.ok) return parsed;
    if (usedNames.has(parsed.value.name)) {
      return fail("duplicate-series", "Series names must be unique.");
    }
    usedNames.add(parsed.value.name);
    series.push(parsed.value);
  }

  const pieCheck = validatePie(chartType as ChartType, series);
  if (pieCheck) return pieCheck;

  return {
    ok: true,
    value: {
      type: "chart",
      title,
      chartType: chartType as ChartType,
      ...optional("xLabel", boundedText(input.xLabel, ARTIFACT_LIMITS.labelLength)),
      ...optional("yLabel", boundedText(input.yLabel, ARTIFACT_LIMITS.labelLength)),
      ...optional("caption", boundedText(input.caption, ARTIFACT_LIMITS.captionLength)),
      series,
    },
  };
}

function parseSeries(
  raw: unknown,
): { ok: true; value: ChartSeries } | { ok: false; code: string; message: string } {
  if (!isRecord(raw)) return fail("invalid-series", "Each series must be an object.");
  const name = boundedText(raw.name, ARTIFACT_LIMITS.labelLength);
  if (!name) return fail("invalid-series-name", "Each series needs a non-empty name.");
  if (!Array.isArray(raw.points) || raw.points.length === 0) {
    return fail("invalid-points", `Series "${name}" needs a non-empty points array.`);
  }
  if (raw.points.length > ARTIFACT_LIMITS.chartPointsPerSeries) {
    return fail(
      "too-many-points",
      `Series "${name}" exceeds ${ARTIFACT_LIMITS.chartPointsPerSeries} points.`,
    );
  }
  const points = [];
  for (const point of raw.points) {
    if (!isRecord(point)) return fail("invalid-point", "Each point must be an object.");
    const y = point.y;
    if (typeof y !== "number" || !Number.isFinite(y)) {
      return fail("invalid-point", "Each point needs a finite numeric y value.");
    }
    let x: string | number;
    if (typeof point.x === "number" && Number.isFinite(point.x)) {
      x = point.x;
    } else {
      const label = boundedText(point.x, ARTIFACT_LIMITS.labelLength);
      if (!label) return fail("invalid-point", "Each point needs a finite number or label x.");
      x = label;
    }
    points.push({ x, y });
  }
  return { ok: true, value: { name, points } };
}

function validatePie(chartType: ChartType, series: ChartSeries[]) {
  if (chartType !== "pie") return undefined;
  if (series.length !== 1) return fail("invalid-pie", "A pie chart accepts exactly one series.");
  const points = series[0]!.points;
  if (points.some((point) => point.y < 0)) {
    return fail("invalid-pie", "Pie slices must not be negative.");
  }
  if (!isDrawablePie(series)) {
    return fail("invalid-pie", "Pie slices must add up to a positive total.");
  }
  return undefined;
}

function fail(code: string, message: string): { ok: false; code: string; message: string } {
  return { ok: false, code, message };
}

function optional<K extends string>(key: K, value: string | undefined) {
  return value ? ({ [key]: value } as Record<K, string>) : ({} as Record<K, never>);
}

/**
 * Markdown data table equivalent to the chart. Rendered next to the SVG for
 * screen readers and exported when the answer is saved to a note.
 */
export function chartDataTable(chart: ChartArtifact): string {
  const categories: Array<string | number> = [];
  for (const series of chart.series) {
    for (const point of series.points) {
      if (!categories.some((value) => String(value) === String(point.x))) categories.push(point.x);
    }
  }
  const header = [chart.xLabel ?? "Category", ...chart.series.map((series) => series.name)];
  const rows = categories.map((category) => {
    const cells = chart.series.map((series) => {
      const point = series.points.find((item) => String(item.x) === String(category));
      return point ? formatNumber(point.y) : "";
    });
    return [String(category), ...cells];
  });
  return [
    `| ${header.map(escapeCell).join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`),
  ].join("\n");
}

export function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|");
}
