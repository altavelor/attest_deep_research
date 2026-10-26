import { describe, expect, it } from "vitest";

import {
  readSubAgentSearchBudget,
  validateSubAgentResources,
  validateSubAgentTaskInput,
} from "@core/research";

describe("sub-agent tool input validation", () => {
  it("accepts a task of exactly 2000 characters after trimming", () => {
    expect(validateSubAgentTaskInput(`  ${"a".repeat(2_000)}  `)).toEqual({
      ok: true,
      value: "a".repeat(2_000),
    });
  });

  it("rejects a direct task over 2000 characters unless the host grants map_sources", () => {
    expect(validateSubAgentTaskInput("a".repeat(2_001))).toEqual({
      ok: false,
      code: "task-too-long",
      message: "Task must not exceed 2000 characters.",
    });
    expect(validateSubAgentTaskInput("a".repeat(8_192), "map_sources").ok).toBe(true);
    expect(validateSubAgentTaskInput("a".repeat(8_193), "map_sources").ok).toBe(false);
  });

  it("defaults, clamps and rejects search budgets and resources with stable codes", () => {
    expect(
      [undefined, 0, 99, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "3"].map((value) => {
        const result = readSubAgentSearchBudget(value);
        return result.ok ? result.value : result.code;
      }),
    ).toEqual([8, 1, 20, ...Array(4).fill("invalid-max-searches")]);
    expect(readSubAgentSearchBudget(2.5)).toMatchObject({
      message: "maxSearches must be an integer.",
    });
    expect(
      [
        undefined,
        [" a.org "],
        Array(8).fill("x".repeat(120)),
        [""],
        ["x".repeat(121)],
        Array(9).fill("a.org"),
        "a.org",
        [1],
      ].map((value) => {
        const result = validateSubAgentResources(value);
        return result.ok ? result.value : result.code;
      }),
    ).toEqual([
      [],
      ["a.org"],
      Array(8).fill("x".repeat(120)),
      ...Array(5).fill("invalid-resources"),
    ]);
    expect(validateSubAgentResources([""])).toMatchObject({
      message: "resources must be an array of at most 8 non-empty strings.",
    });
  });
});
