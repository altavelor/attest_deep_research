import { describe, expect, it } from "vitest";

import { formatResearchAnswerNote } from "@application/use-cases/research";
import { sanitizeAnswerArtifacts } from "@core/media";
import type { ResearchAnswer } from "@core/answer";

const answer: ResearchAnswer = {
  question: "How is solar capacity growing?",
  answer: "Capacity keeps rising.",
  citations: [],
  followUpQuestions: [],
  createdAt: "2026-08-02T10:00:00.000Z",
  artifacts: [
    {
      type: "image-gallery",
      id: "gallery_1",
      title: "Solar farms",
      images: [
        {
          id: "img_1",
          fullUrl: "https://upload.wikimedia.org/farm.jpg",
          alt: "A solar farm",
          sourceUrl: "https://commons.wikimedia.org/wiki/File:Farm.jpg",
          sourceLabel: "Wikimedia Commons · Jane",
          licenceName: "CC BY-SA 4.0",
          licensed: true,
        },
        {
          id: "img_2",
          fullUrl: "https://news.example.com/panel.png",
          alt: "Panels",
          sourceUrl: "https://news.example.com/article",
          sourceLabel: "Example News",
        },
      ],
    },
    {
      type: "chart",
      id: "chart_1",
      title: "Installed capacity",
      chartType: "line",
      xLabel: "Year",
      caption: "Source: cited report.",
      series: [
        {
          name: "GW",
          points: [
            { x: "2024", y: 100 },
            { x: "2025", y: 140 },
          ],
        },
      ],
    },
  ],
};

describe("saved note export", () => {
  const note = formatResearchAnswerNote(answer);

  it("exports image attribution and source links, never image bytes", () => {
    expect(note).toContain("## Solar farms");
    expect(note).toContain(
      "| A solar farm | [Wikimedia Commons · Jane](https://commons.wikimedia.org/wiki/File:Farm.jpg) | CC BY-SA 4.0 |",
    );
    expect(note).not.toContain("https://upload.wikimedia.org/farm.jpg");
    expect(note).not.toContain("base64");
  });

  it("never labels an unlicensed page image as licensed content", () => {
    expect(note).toContain(
      "| Panels | [Example News](https://news.example.com/article) | Page reference |",
    );
  });

  it("exports chart data as a Markdown table", () => {
    expect(note).toContain("## Installed capacity");
    expect(note).toContain("| Year | GW |");
    expect(note).toContain("| 2024 | 100 |");
    expect(note).toContain("Source: cited report.");
  });

  it("keeps a text-only answer unchanged", () => {
    const plain = formatResearchAnswerNote({ ...answer, artifacts: undefined });
    expect(plain).toContain("## Citations");
    expect(plain).not.toContain("## Solar farms");
  });
});

describe("saved chat round-trip", () => {
  it("restores artifacts through JSON persistence", () => {
    const restored = JSON.parse(JSON.stringify(answer)) as ResearchAnswer;
    expect(sanitizeAnswerArtifacts(restored.artifacts)).toEqual(answer.artifacts);
  });

  it("loads a legacy answer without artifacts", () => {
    const legacy = JSON.parse(
      JSON.stringify({ ...answer, artifacts: undefined }),
    ) as ResearchAnswer;
    expect(legacy.artifacts).toBeUndefined();
    expect(sanitizeAnswerArtifacts(legacy.artifacts)).toBeUndefined();
  });

  it("drops artifacts a tampered chat file introduced", () => {
    const tampered = [
      { type: "image-gallery", id: "g", images: [{ id: "x", alt: "", sourceUrl: "" }] },
      { type: "html", id: "h", markup: "<script>alert(1)</script>" },
    ];
    expect(sanitizeAnswerArtifacts(tampered)).toBeUndefined();
  });
});
