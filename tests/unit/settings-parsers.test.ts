import { describe, expect, it } from "vitest";

import {
  DEFAULT_INDEX_PROFILE,
  normalizeChunkOverlap,
  normalizeIndexProfileNumbers,
  normalizeListInput,
  normalizeProfileName,
  normalizeUrl,
  readActiveIndexProfileId,
  readApiFormat,
  readIndexDescription,
  readNonNegativeIntegerOrUndefined,
  readOptionalNumber,
  readOptionalPositiveInteger,
  readString,
  readStringList,
} from "@adapters/settings";

describe("settings parsers", () => {
  it("normalizes user-entered text fields and preserves only meaningful list items", () => {
    expect(normalizeListInput("  Notes  \n\n Research \n  ")).toEqual(["Notes", "Research"]);
    expect(normalizeUrl(" https://api.example.test/// ", "https://fallback.test")).toBe(
      "https://api.example.test",
    );
    expect(normalizeUrl("  ", "https://fallback.test")).toBe("https://fallback.test");
    expect(normalizeProfileName("  Personal   OpenAI  ")).toBe("Personal OpenAI");
    expect(readString("  value ")).toBe("value");
    expect(readString(12)).toBe("");
    expect(readStringList([" one ", 1, "", "two"], ["fallback"])).toEqual(["one", "two"]);
    expect(readStringList([], ["fallback"])).toEqual(["fallback"]);
    expect(readStringList("one", ["fallback"])).toEqual(["fallback"]);
  });

  it("accepts only supported protocols, profile ids, and finite numeric values", () => {
    expect(readApiFormat("openai-compatible")).toBe("openai-compatible");
    expect(readApiFormat("unknown")).toBeNull();
    expect(
      readActiveIndexProfileId(" secondary ", [
        { ...DEFAULT_INDEX_PROFILE, id: "primary" },
        { ...DEFAULT_INDEX_PROFILE, id: "secondary" },
      ]),
    ).toBe("secondary");
    expect(readActiveIndexProfileId("missing", [{ ...DEFAULT_INDEX_PROFILE, id: "primary" }])).toBe(
      "primary",
    );
    expect(readOptionalPositiveInteger(3)).toBe(3);
    expect(readOptionalPositiveInteger(0)).toBeUndefined();
    expect(readOptionalNumber(1.5)).toBe(1.5);
    expect(readOptionalNumber(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(readNonNegativeIntegerOrUndefined(0)).toBe(0);
    expect(readNonNegativeIntegerOrUndefined(-1)).toBeUndefined();
  });

  it("accepts only complete persisted index descriptions", () => {
    const description = {
      text: "A useful index description.",
      generatedAt: "2026-08-01T00:00:00.000Z",
      indexUpdatedAt: "2026-08-01T00:00:00.000Z",
      generator: "deterministic",
      algorithmVersion: 2,
      status: "current",
      sourceCount: 3,
      chunkCount: 9,
      diagnostics: {
        representativeChunkCount: 2,
        truncated: false,
        usedFallback: false,
        failureReason: "previous run failed",
      },
    } as const;

    expect(readIndexDescription(description)).toEqual(description);
    expect(readIndexDescription({ ...description, text: "" })).toBeUndefined();
    expect(readIndexDescription({ ...description, status: "unknown" })).toBeUndefined();
    expect(
      readIndexDescription({
        ...description,
        diagnostics: { ...description.diagnostics, truncated: "false" },
      }),
    ).toBeUndefined();
  });

  it("repairs invalid chunk settings and bounds overlap to the selected chunk size", () => {
    const profile = {
      ...DEFAULT_INDEX_PROFILE,
      chunkSize: -20,
      chunkOverlap: 900,
      pdfChunkSize: 100,
      pdfChunkOverlap: 100,
      embeddingBatchSize: 0,
    };

    normalizeIndexProfileNumbers(profile);

    expect(profile.chunkSize).toBe(800);
    expect(profile.chunkOverlap).toBe(799);
    expect(profile.pdfChunkSize).toBe(100);
    expect(profile.pdfChunkOverlap).toBe(99);
    expect(profile.embeddingBatchSize).toBe(32);
    expect(normalizeChunkOverlap(-2, 100)).toBe(0);
  });
});
