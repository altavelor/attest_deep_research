import { isPublicHttpsUrl, isSafeVaultImagePath, validateImageUrl } from "./imagePolicy";

export const CHART_TYPES = ["bar", "line", "scatter", "pie"] as const;

export type ChartType = (typeof CHART_TYPES)[number];

export interface AnswerImageVaultSource {
  /** Fingerprint of the document when the image was discovered, when known. */
  contentHash?: string;
  documentPath: string;

  locator: string;
}

export interface AnswerImage {
  id: string;
  thumbnailUrl?: string;
  fullUrl?: string;
  vaultSource?: AnswerImageVaultSource;
  alt: string;
  caption?: string;
  sourceUrl: string;
  sourceLabel: string;

  licenceName?: string;
  licenceUrl?: string;

  licensed?: boolean;
}

export interface ChartPoint {
  x: string | number;
  y: number;
}

export interface ChartSeries {
  name: string;
  points: ChartPoint[];
}

export interface ImageGalleryArtifact {
  type: "image-gallery";
  id: string;
  title?: string;
  images: AnswerImage[];
}

export interface ChartArtifact {
  type: "chart";
  id: string;
  title: string;
  chartType: ChartType;
  xLabel?: string;
  yLabel?: string;
  series: ChartSeries[];
  caption?: string;
}

export type AnswerArtifact = ImageGalleryArtifact | ChartArtifact;

export const ARTIFACT_LIMITS = {
  galleryImages: 12,
  chartSeries: 4,
  chartPointsPerSeries: 50,
  titleLength: 200,
  captionLength: 500,
  altLength: 300,
  labelLength: 80,
  urlLength: 2048,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function isOptionalBoundedString(value: unknown, maxLength: number): boolean {
  return value === undefined || isBoundedString(value, maxLength);
}

/**
 * Every URL an artifact carries is re-validated here, because a saved chat is
 * untrusted input: hotlinks must stay public HTTPS image URLs, and a source or
 * licence link must be either a public HTTPS page or a contained vault path.
 */
export function isAnswerImage(value: unknown): value is AnswerImage {
  if (!isRecord(value)) return false;
  const hasVaultSource = value.vaultSource !== undefined;
  const hasLocation =
    isOptionalImageUrl(value.thumbnailUrl) &&
    isOptionalImageUrl(value.fullUrl) &&
    (!hasVaultSource || isVaultSource(value.vaultSource));
  return (
    isBoundedString(value.id, ARTIFACT_LIMITS.labelLength) &&
    typeof value.alt === "string" &&
    value.alt.length <= ARTIFACT_LIMITS.altLength &&
    isOptionalBoundedString(value.caption, ARTIFACT_LIMITS.captionLength) &&
    isBoundedString(value.sourceUrl, ARTIFACT_LIMITS.urlLength) &&
    isSafeSourceUrl(value.sourceUrl, hasVaultSource) &&
    isBoundedString(value.sourceLabel, ARTIFACT_LIMITS.titleLength) &&
    isOptionalBoundedString(value.licenceName, ARTIFACT_LIMITS.labelLength) &&
    (value.licenceUrl === undefined || isPublicHttpsUrl(value.licenceUrl)) &&
    (value.licensed === undefined || typeof value.licensed === "boolean") &&
    hasLocation
  );
}

function isOptionalImageUrl(value: unknown): boolean {
  if (value === undefined) return true;
  return isBoundedString(value, ARTIFACT_LIMITS.urlLength) && validateImageUrl(value as string).ok;
}

/** A vault-backed image may point at its document; anything else must be HTTPS. */
function isSafeSourceUrl(value: unknown, hasVaultSource: boolean): boolean {
  if (typeof value !== "string") return false;
  if (isPublicHttpsUrl(value)) return true;
  return hasVaultSource && isSafeVaultImagePath(value);
}

function isVaultSource(value: unknown): value is AnswerImageVaultSource {
  return (
    isRecord(value) &&
    isBoundedString(value.documentPath, 1024) &&
    isBoundedString(value.locator, 512) &&
    isOptionalBoundedString(value.contentHash, 128)
  );
}

function isChartPoint(value: unknown): value is ChartPoint {
  if (!isRecord(value)) return false;
  const xOk =
    (typeof value.x === "string" && value.x.length <= ARTIFACT_LIMITS.labelLength) ||
    (typeof value.x === "number" && Number.isFinite(value.x));
  return xOk && typeof value.y === "number" && Number.isFinite(value.y);
}

function isChartSeries(value: unknown): value is ChartSeries {
  return (
    isRecord(value) &&
    isBoundedString(value.name, ARTIFACT_LIMITS.labelLength) &&
    Array.isArray(value.points) &&
    value.points.length > 0 &&
    value.points.length <= ARTIFACT_LIMITS.chartPointsPerSeries &&
    value.points.every(isChartPoint)
  );
}

export function isAnswerArtifact(value: unknown): value is AnswerArtifact {
  if (!isRecord(value)) return false;
  if (value.type === "image-gallery") {
    return (
      isBoundedString(value.id, ARTIFACT_LIMITS.labelLength) &&
      isOptionalBoundedString(value.title, ARTIFACT_LIMITS.titleLength) &&
      Array.isArray(value.images) &&
      value.images.length > 0 &&
      value.images.length <= ARTIFACT_LIMITS.galleryImages &&
      value.images.every(isAnswerImage)
    );
  }
  if (value.type === "chart") {
    return (
      isBoundedString(value.id, ARTIFACT_LIMITS.labelLength) &&
      isBoundedString(value.title, ARTIFACT_LIMITS.titleLength) &&
      typeof value.chartType === "string" &&
      (CHART_TYPES as readonly string[]).includes(value.chartType) &&
      isOptionalBoundedString(value.xLabel, ARTIFACT_LIMITS.labelLength) &&
      isOptionalBoundedString(value.yLabel, ARTIFACT_LIMITS.labelLength) &&
      isOptionalBoundedString(value.caption, ARTIFACT_LIMITS.captionLength) &&
      Array.isArray(value.series) &&
      value.series.length > 0 &&
      value.series.length <= ARTIFACT_LIMITS.chartSeries &&
      value.series.every(isChartSeries) &&
      (value.chartType !== "pie" || isDrawablePie(value.series as ChartSeries[]))
    );
  }
  return false;
}

/**
 * A pie is drawable only as a single series of non-negative slices with a
 * positive total; anything else divides by zero or silently drops data.
 */
export function isDrawablePie(series: readonly ChartSeries[]): boolean {
  if (series.length !== 1) return false;
  const points = series[0]!.points;
  if (points.some((point) => point.y < 0)) return false;
  return points.reduce((total, point) => total + point.y, 0) > 0;
}

/**
 * Keeps only artifacts that satisfy the DTO contract. Used when loading saved
 * chats and when accepting artifacts produced during a run, so malformed or
 * legacy data degrades to a text-only answer instead of failing the render.
 */
export function sanitizeAnswerArtifacts(value: unknown): AnswerArtifact[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const artifacts = value.filter(isAnswerArtifact);
  return artifacts.length > 0 ? artifacts : undefined;
}
