import { describe, expect, it } from "vitest";

import {
  chartDataTable,
  isAnswerArtifact,
  sanitizeAnswerArtifacts,
  toAnswerImage,
  validateChartInput,
  validateImageUrl,
  isSafeVaultImagePath,
  hasDisplayableDimensions,
  ARTIFACT_LIMITS,
  imageQueryVariants,
  type AnswerArtifact,
  type ChartArtifact,
  type ImageCandidate,
} from "@core/media";
import type { ResearchAnswer } from "@core/answer";

const gallery: AnswerArtifact = {
  type: "image-gallery",
  id: "g1",
  title: "Examples",
  images: [
    {
      id: "img1",
      fullUrl: "https://upload.wikimedia.org/a/b.jpg",
      alt: "A cat",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:B.jpg",
      sourceLabel: "Wikimedia Commons",
    },
  ],
};

describe("answer artifact contracts", () => {
  it("keeps text-only answers valid without artifacts", () => {
    const answer: ResearchAnswer = {
      question: "q",
      answer: "text",
      citations: [],
      followUpQuestions: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    expect(answer.artifacts).toBeUndefined();
    expect(sanitizeAnswerArtifacts(undefined)).toBeUndefined();
  });

  it("accepts a well-formed gallery and chart", () => {
    expect(isAnswerArtifact(gallery)).toBe(true);
    const chart: ChartArtifact = {
      type: "chart",
      id: "c1",
      title: "Growth",
      chartType: "line",
      series: [{ name: "A", points: [{ x: "2024", y: 1 }] }],
    };
    expect(isAnswerArtifact(chart)).toBe(true);
  });

  it("drops malformed artifacts instead of failing the answer", () => {
    const artifacts = sanitizeAnswerArtifacts([
      gallery,
      { type: "chart", id: "c", title: "t", chartType: "pyramid", series: [] },
      { type: "image-gallery", id: "g", images: [] },
      "not an object",
    ]);
    expect(artifacts).toEqual([gallery]);
  });

  it("accepts a gallery up to the image limit and rejects one above it", () => {
    const images = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ ...gallery.images[0]!, id: `img${index}` }));
    expect(isAnswerArtifact({ ...gallery, images: images(ARTIFACT_LIMITS.galleryImages) })).toBe(
      true,
    );
    expect(
      isAnswerArtifact({ ...gallery, images: images(ARTIFACT_LIMITS.galleryImages + 1) }),
    ).toBe(false);
  });
});

describe("image url and path policy", () => {
  it.each([
    ["http://example.com/a.png", "insecure-protocol"],
    ["data:image/png;base64,AAAA", "blocked-protocol"],
    ["javascript:alert(1)", "blocked-protocol"],
    ["https://user:pass@example.com/a.png", "credentials-not-allowed"],
    ["https://localhost/a.png", "local-hostname"],
    ["https://192.168.0.5/a.png", "non-public-address"],
    ["https://example.com/logo.svg", "unsupported-format"],
    ["not a url", "invalid-url"],
  ])("rejects %s", (url, reason) => {
    const result = validateImageUrl(url);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe(reason);
  });

  it("accepts a public https image url and strips the fragment", () => {
    const result = validateImageUrl("https://example.com/photo.JPG#frag");
    expect(result).toEqual({ ok: true, url: "https://example.com/photo.JPG" });
  });

  it("accepts extensionless CDN urls", () => {
    expect(validateImageUrl("https://images.example.com/render/abcdef").ok).toBe(true);
  });

  it.each([
    ["notes/a.png", true],
    ["../secret.png", false],
    ["/abs/a.png", false],
    [".ixplorer/x.png", false],
    ["c:\\a.png", false],
  ])("vault path %s containment is %s", (path, expected) => {
    expect(isSafeVaultImagePath(path)).toBe(expected);
  });

  it("rejects tracking-pixel dimensions and decompression bombs", () => {
    expect(hasDisplayableDimensions(1, 1)).toBe(false);
    expect(hasDisplayableDimensions(40_000, 40_000)).toBe(false);
    expect(hasDisplayableDimensions(800, 600)).toBe(true);
    expect(hasDisplayableDimensions(undefined, undefined)).toBe(true);
  });
});

describe("candidate normalization", () => {
  const base: ImageCandidate = {
    id: "cand1",
    origin: "provider",
    fullUrl: "https://example.com/a.png",
    alt: "Alt text",
    sourceUrl: "https://example.com/page",
    sourceLabel: "Example",
  };

  it("keeps licence metadata only when the provider marked the image licensed", () => {
    expect(
      toAnswerImage({
        ...base,
        licenceName: "CC BY 4.0",
        licenceUrl: "https://cc/by",
        licensed: true,
      }),
    ).toMatchObject({ licenceName: "CC BY 4.0", licensed: true });
    expect(toAnswerImage({ ...base, licenceName: "CC BY 4.0" })).not.toHaveProperty("licenceName");
  });

  it("drops candidates without a usable location", () => {
    expect(toAnswerImage({ ...base, fullUrl: "http://example.com/a.png" })).toBeUndefined();
  });

  it("keeps a contained vault source and falls back to the document as attribution", () => {
    const image = toAnswerImage({
      id: "v1",
      origin: "document",
      vaultSource: { documentPath: "docs/report.pdf", locator: "page:2:0" },
      alt: "Figure",
      sourceUrl: "docs/report.pdf",
      sourceLabel: "report.pdf",
    });
    expect(image).toMatchObject({
      vaultSource: { documentPath: "docs/report.pdf", locator: "page:2:0" },
      sourceUrl: "docs/report.pdf",
    });
  });

  it("rejects traversal vault paths", () => {
    expect(
      toAnswerImage({
        id: "v2",
        origin: "document",
        vaultSource: { documentPath: "../outside.pdf", locator: "x" },
        alt: "",
        sourceUrl: "../outside.pdf",
        sourceLabel: "outside",
      }),
    ).toBeUndefined();
  });
});

describe("image query shaping", () => {
  it("drops medium words so a natural-language query can still match", () => {
    expect(imageQueryVariants("схема солнечной системы планеты")).toEqual([
      "схема солнечной системы планеты",
      "солнечной системы планеты",
      "солнечной системы",
    ]);
  });

  it("keeps the query when every word is a medium word", () => {
    expect(imageQueryVariants("диаграмма схема")).toEqual(["диаграмма схема"]);
  });

  it("does not repeat a variant for an already short query", () => {
    expect(imageQueryVariants("solar system")).toEqual(["solar system"]);
  });

  it("caps a long query to its leading content terms", () => {
    expect(imageQueryVariants("photo of a red fox in deep winter snow")).toEqual([
      "photo of a red fox in deep winter snow",
      "of a red fox",
      "of a",
    ]);
  });

  it("returns nothing for an empty query", () => {
    expect(imageQueryVariants("   ")).toEqual([]);
  });
});

describe("chart validation", () => {
  it("accepts a bounded chart", () => {
    const result = validateChartInput({
      title: "Revenue",
      chartType: "bar",
      xLabel: "Quarter",
      series: [
        {
          name: "2025",
          points: [
            { x: "Q1", y: 10 },
            { x: "Q2", y: 12 },
          ],
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it.each([
    [{ title: "", chartType: "bar", series: [] }, "invalid-title"],
    [{ title: "t", chartType: "donut", series: [] }, "invalid-chart-type"],
    [{ title: "t", chartType: "bar", series: [] }, "invalid-series"],
    [
      {
        title: "t",
        chartType: "bar",
        series: [{ name: "a", points: [{ x: "1", y: Number.NaN }] }],
      },
      "invalid-point",
    ],
    [
      {
        title: "t",
        chartType: "bar",
        series: [
          { name: "a", points: [{ x: "1", y: 1 }] },
          { name: "b", points: [{ x: "1", y: 1 }] },
          { name: "c", points: [{ x: "1", y: 1 }] },
          { name: "d", points: [{ x: "1", y: 1 }] },
          { name: "e", points: [{ x: "1", y: 1 }] },
        ],
      },
      "too-many-series",
    ],
    [
      {
        title: "t",
        chartType: "bar",
        series: [
          {
            name: "a",
            points: Array.from({ length: 51 }, (_, index) => ({ x: index, y: 1 })),
          },
        ],
      },
      "too-many-points",
    ],
    [
      { title: "t", chartType: "pie", series: [{ name: "a", points: [{ x: "1", y: 0 }] }] },
      "invalid-pie",
    ],
    [
      {
        title: "t",
        chartType: "pie",
        series: [
          { name: "a", points: [{ x: "1", y: 1 }] },
          { name: "b", points: [{ x: "1", y: 1 }] },
        ],
      },
      "invalid-pie",
    ],
  ])("rejects invalid input (%#)", (input, code) => {
    const result = validateChartInput(input as Record<string, unknown>);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe(code);
  });

  it("renders an equivalent data table", () => {
    const chart: ChartArtifact = {
      type: "chart",
      id: "c",
      title: "Revenue",
      chartType: "bar",
      xLabel: "Quarter",
      series: [
        {
          name: "2025",
          points: [
            { x: "Q1", y: 10 },
            { x: "Q2", y: 12.5 },
          ],
        },
        { name: "2026", points: [{ x: "Q1", y: 11 }] },
      ],
    };
    expect(chartDataTable(chart)).toBe(
      [
        "| Quarter | 2025 | 2026 |",
        "| --- | --- | --- |",
        "| Q1 | 10 | 11 |",
        "| Q2 | 12.5 |  |",
      ].join("\n"),
    );
  });
});
