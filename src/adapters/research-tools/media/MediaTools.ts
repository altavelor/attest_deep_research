// Model-facing tools for rich answer media. `search_images` discovers bounded
// candidates; `present_image_gallery` and `present_chart` turn already-discovered
// data into artifacts. None of them accepts markup, styles, or arbitrary URLs,
// and an invalid call never fails the textual answer.

import {
  IMAGE_SEARCH_TOOL,
  PRESENT_CHART_TOOL,
  PRESENT_IMAGE_GALLERY_TOOL,
  ToolParseResult,
  toolFailure,
} from "@core/agent";
import {
  ARTIFACT_LIMITS,
  CHART_TYPES,
  ImageCandidate,
  imageQueryVariants,
  rankImageCandidates,
  toAnswerImage,
} from "@core/media";
import { validateChartInput } from "@core/media";
import type { ImageSearchRegistry } from "@application/ports";
import { defineTool, enumOf, int, str, strArray, text } from "@application/sources/tools";
import { AnswerArtifactRegistry } from "./AnswerArtifactRegistry";

const MAX_QUERY_LENGTH = 200;
const FETCHED_PAGES_LABEL = "fetched pages";

export interface ImageSearchDeps {
  registry: ImageSearchRegistry;
  artifacts: AnswerArtifactRegistry;
  /** Candidates already available locally (context documents read in this run). */
  documentCandidates?: () => Promise<ImageCandidate[]> | ImageCandidate[];
}

interface SearchImagesInput {
  query: string;
  limit: number;
}

export interface SearchImagesOutput {
  images: Array<{
    imageId: string;
    alt: string;
    caption?: string;
    sourceUrl: string;
    sourceLabel: string;
    licence?: string;
    origin: string;
  }>;
  diagnostics: {
    resultCount: number;
    sourcesQueried: string[];
    /** Set when a broader query variant was needed to get any match. */
    effectiveQuery?: string;
    /** Resources that errored; their absence from the results is not a "no match". */
    failedSources?: string[];
    untrustedEvidence: true;
  };
}

/**
 * Searches every enabled image resource plus locally available document images.
 * Returns opaque per-run handles; provider failures are reported as diagnostics
 * rather than failing the call when at least one source answered.
 */
export const ImageSearchTool = defineTool<ImageSearchDeps, SearchImagesInput, SearchImagesOutput>({
  name: IMAGE_SEARCH_TOOL,
  description:
    "Find images for the answer from the enabled image resources, from documents read in this run, and from pages already fetched with fetch_web_page. Use two or three concrete subject words rather than a full question — resources index short file metadata, and English matches best. Returns opaque imageIds to pass to present_image_gallery; it never returns URLs you can invent.",
  schema: {
    query: str(MAX_QUERY_LENGTH, {
      required: true,
      description: "Two or three concrete subject words describing what the image shows.",
    }),
    limit: int(1, 24, 10, { description: "Maximum candidates to return." }),
  },
  execute: async (deps, input) => {
    const sources = deps.registry.enabledImageSources();
    const queried: string[] = [];
    const failedSources: string[] = [];
    const collected: ImageCandidate[] = [];

    const local = await Promise.resolve(deps.documentCandidates?.() ?? []);
    if (local.length > 0) {
      queried.push("vault documents");
      collected.push(...local.slice(0, input.limit));
    }

    let effectiveQuery = input.query;
    for (const variant of imageQueryVariants(input.query)) {
      const settled = await Promise.allSettled(
        sources.map((source) => source.searchImages(variant, { limit: input.limit })),
      );
      let found = 0;
      settled.forEach((outcome, index) => {
        const label = sources[index]!.descriptor.label;
        if (outcome.status !== "fulfilled") {
          if (!failedSources.includes(label)) failedSources.push(label);
          return;
        }
        if (!queried.includes(label)) queried.push(label);
        found += outcome.value.length;
        collected.push(...outcome.value);
      });
      effectiveQuery = variant;
      if (found > 0) break;
    }

    const registered = deps.artifacts.register(
      rankImageCandidates(collected, input.query, input.limit),
    );
    const fromFetchedPages = deps.artifacts
      .registeredByOrigin("page")
      .filter((entry) => !registered.some((item) => item.handle === entry.handle))
      .slice(0, Math.max(0, input.limit - registered.length));
    const results = [...registered, ...fromFetchedPages];

    if (results.length === 0) {
      return imageSearchFailure(sources.length, failedSources, local.length);
    }
    if (fromFetchedPages.length > 0 && !queried.includes(FETCHED_PAGES_LABEL)) {
      queried.push(FETCHED_PAGES_LABEL);
    }

    return {
      ok: true,
      value: {
        images: results.map(({ handle, candidate }) => ({
          imageId: handle,
          alt: candidate.alt,
          ...(candidate.caption ? { caption: candidate.caption } : {}),
          sourceUrl: candidate.sourceUrl,
          sourceLabel: candidate.sourceLabel,
          ...(candidate.licensed && candidate.licenceName
            ? { licence: candidate.licenceName }
            : {}),
          origin: candidate.origin,
        })),
        diagnostics: {
          resultCount: results.length,
          sourcesQueried: queried,
          ...(effectiveQuery !== input.query ? { effectiveQuery } : {}),
          ...(failedSources.length > 0 ? { failedSources } : {}),
          untrustedEvidence: true as const,
        },
      },
    };
  },
});

/** Distinguishes "nothing enabled", "provider broke" and "genuinely no match". */
function imageSearchFailure(
  sourceCount: number,
  failedSources: readonly string[],
  localCount: number,
) {
  if (sourceCount === 0 && localCount === 0) {
    return toolFailure(
      "no-image-sources",
      "No image resource is enabled, no read document contains images, and no fetched page referenced one. Enable Wikimedia Commons or Openverse under External sources, or fetch a page that carries images.",
    );
  }
  if (failedSources.length > 0 && failedSources.length === sourceCount) {
    return toolFailure(
      "image-search-failed",
      `Every image resource failed to answer (${failedSources.join(", ")}).`,
      true,
    );
  }
  return toolFailure(
    "no-image-candidates",
    "No eligible images matched. Image resources index short English file metadata, so retry with two or three concrete subject words (English works best) instead of a full question.",
  );
}

interface PresentGalleryInput {
  imageIds: string[];
  title?: string;
}

export interface PresentGalleryOutput {
  artifactId: string;
  imageCount: number;
}

/** Builds a gallery from 1–4 unique handles discovered earlier in the same run. */
export const PresentImageGalleryTool = defineTool<
  { artifacts: AnswerArtifactRegistry },
  PresentGalleryInput,
  PresentGalleryOutput
>({
  name: PRESENT_IMAGE_GALLERY_TOOL,
  description:
    "Show up to 12 images found in this run below the answer. Pass only imageIds returned by search_images; URLs are rejected. Keep the citation for each image in nearby prose.",
  schema: {
    imageIds: strArray(ARTIFACT_LIMITS.galleryImages, 64, {
      description: `Between 1 and ${ARTIFACT_LIMITS.galleryImages} imageIds from search_images.`,
    }),
    title: str(ARTIFACT_LIMITS.titleLength, { description: "Optional gallery heading." }),
  },
  parse: (input): ToolParseResult<PresentGalleryInput> => {
    const keys = Object.keys(input);
    if (keys.some((key) => key !== "imageIds" && key !== "title")) {
      return toolFailure("unknown-property", "present_image_gallery accepts imageIds and title.");
    }
    const raw = input.imageIds;
    if (!Array.isArray(raw) || raw.length === 0) {
      return toolFailure("invalid-image-ids", "imageIds must be a non-empty array of handles.");
    }
    if (raw.length > ARTIFACT_LIMITS.galleryImages) {
      return toolFailure(
        "too-many-images",
        `A gallery shows at most ${ARTIFACT_LIMITS.galleryImages} images.`,
      );
    }
    const imageIds: string[] = [];
    for (const item of raw) {
      const id = typeof item === "string" ? item.trim() : "";
      if (!id || id.length > 64) {
        return toolFailure(
          "invalid-image-ids",
          "Each imageId must be a handle from search_images.",
        );
      }
      if (!imageIds.includes(id)) imageIds.push(id);
    }
    const title = typeof input.title === "string" ? input.title.trim() : "";
    return {
      ok: true,
      value: { imageIds, ...(title ? { title: title.slice(0, ARTIFACT_LIMITS.titleLength) } : {}) },
    };
  },
  execute: async (deps, input) => {
    const images = [];
    for (const imageId of input.imageIds) {
      const candidate = deps.artifacts.resolve(imageId);
      if (!candidate) {
        return toolFailure(
          "unknown-image-id",
          `${imageId} is not an image discovered in this answer.`,
        );
      }
      const image = toAnswerImage(candidate);
      if (!image) {
        return toolFailure("unusable-image", `${imageId} cannot be displayed safely.`);
      }
      images.push({ ...image, id: imageId });
    }

    const artifactId = deps.artifacts.nextArtifactId("gallery");
    const added = deps.artifacts.add({
      type: "image-gallery",
      id: artifactId,
      ...(input.title ? { title: input.title } : {}),
      images,
    });
    if (!added) {
      return toolFailure("gallery-rejected", "The gallery could not be added to this answer.");
    }
    return { ok: true, value: { artifactId, imageCount: images.length } };
  },
});

export interface PresentChartOutput {
  artifactId: string;
  chartType: string;
  seriesCount: number;
}

/** Accepts chart data only; the SVG is produced locally from the validated DTO. */
export const PresentChartTool = defineTool<
  { artifacts: AnswerArtifactRegistry },
  Record<string, unknown>,
  PresentChartOutput
>({
  name: PRESENT_CHART_TOOL,
  description:
    "Render a bar, line, scatter, or pie chart below the answer from data you already have. Supply data only — markup, SVG, styles, and URLs are rejected. Limits: 4 series, 50 points per series.",
  schema: {
    title: str(ARTIFACT_LIMITS.titleLength, { required: true, description: "Chart title." }),
    chartType: enumOf(CHART_TYPES, { required: true, description: "Chart form." }),
    xLabel: str(ARTIFACT_LIMITS.labelLength, { description: "Category axis label." }),
    yLabel: str(ARTIFACT_LIMITS.labelLength, { description: "Value axis label." }),
    caption: text({ maxLength: ARTIFACT_LIMITS.captionLength, description: "Short caption." }),
  },
  parse: (input): ToolParseResult<Record<string, unknown>> => {
    const allowed = new Set(["title", "chartType", "xLabel", "yLabel", "caption", "series"]);
    const unknown = Object.keys(input).find((key) => !allowed.has(key));
    if (unknown) {
      return toolFailure("unknown-property", `present_chart does not accept "${unknown}".`);
    }
    const validation = validateChartInput(input);
    if (!validation.ok) return toolFailure(validation.code, validation.message);
    return { ok: true, value: validation.value as unknown as Record<string, unknown> };
  },
  execute: async (deps, input) => {
    const artifactId = deps.artifacts.nextArtifactId("chart");
    const chart = { ...(input as object), id: artifactId } as Parameters<
      AnswerArtifactRegistry["add"]
    >[0];
    if (!deps.artifacts.add(chart)) {
      return toolFailure("chart-rejected", "The chart could not be added to this answer.");
    }
    const series = Array.isArray(input.series) ? input.series.length : 0;
    return {
      ok: true,
      value: { artifactId, chartType: String(input.chartType), seriesCount: series },
    };
  },
});
