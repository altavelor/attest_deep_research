import {
  detectTextLanguages,
  languageInventoryFromSources,
} from "../../src/indexing/languageDetection";

describe("language detection", () => {
  it("detects dominant Russian Cyrillic text", () => {
    expect(
      detectTextLanguages(
        "Методы сортировки включают быструю сортировку, сортировку слиянием и сортировку вставками. Их плюсы и минусы зависят от сложности алгоритма.",
      ),
    ).toEqual(["ru"]);
  });

  it("detects dominant English Latin text", () => {
    expect(
      detectTextLanguages(
        "Sorting algorithms include quicksort, merge sort, heap sort, and insertion sort. Their advantages and disadvantages depend on time complexity.",
      ),
    ).toEqual(["en"]);
  });

  it("returns unknown for short ambiguous text", () => {
    expect(detectTextLanguages("123 sort ???")).toEqual(["unknown"]);
  });

  it("aggregates language inventory from source snapshots", () => {
    expect(
      languageInventoryFromSources([
        { languages: ["en"], chunkCount: 3 },
        { languages: ["ru"], chunkCount: 2 },
        { languages: ["en", "ru"], chunkCount: 1 },
        { languages: ["en"], chunkCount: 10, failed: true },
      ]),
    ).toEqual([
      { language: "en", chunkCount: 4, sourceCount: 2 },
      { language: "ru", chunkCount: 3, sourceCount: 2 },
    ]);
  });
});
