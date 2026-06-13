import { isRecord } from "../../src/shared/guards";
import {
  isNonNegativeInteger,
  isPositiveInteger,
  parseNonNegativeInteger,
  parsePositiveInteger,
  positiveIntegerOrDefault,
} from "../../src/shared/numbers";
import {
  isPathIncluded,
  normalizeVaultFolder,
  normalizeVaultPath,
  vaultPathMatchesGlob,
} from "../../src/shared/pathFilters";
import { stripRenderedCitationIds } from "../../src/ui/citationText";

describe("shared helpers", () => {
  it("checks plain records", () => {
    expect(isRecord({ ok: true })).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord([])).toBe(false);
  });

  it("parses and validates integer values", () => {
    expect(positiveIntegerOrDefault(4, 1)).toBe(4);
    expect(positiveIntegerOrDefault(0, 1)).toBe(1);
    expect(parsePositiveInteger(" 5 ")).toBe(5);
    expect(parsePositiveInteger("0")).toBeNull();
    expect(parseNonNegativeInteger("0")).toBe(0);
    expect(parseNonNegativeInteger("-1")).toBeNull();
    expect(isPositiveInteger(1)).toBe(true);
    expect(isPositiveInteger(0)).toBe(false);
    expect(isNonNegativeInteger(0)).toBe(true);
  });

  it("normalizes vault paths and matches include folders/globs", () => {
    expect(normalizeVaultPath("\\Research//ai.md")).toBe("Research/ai.md");
    expect(normalizeVaultFolder(" /Research/ ")).toBe("Research");
    expect(normalizeVaultFolder(".")).toBe("");
    expect(isPathIncluded("Research/ai.md", ["Research"])).toBe(true);
    expect(isPathIncluded("Other/ai.md", ["Research"])).toBe(false);
    expect(vaultPathMatchesGlob("Research/private/a.md", "Research/**")).toBe(true);
    expect(vaultPathMatchesGlob("Research/private/a.md", "Research/*.md")).toBe(false);
  });

  it("strips rendered citation ids", () => {
    expect(stripRenderedCitationIds("Answer [12345678] text [short]")).toBe("Answer text [short]");
  });
});
