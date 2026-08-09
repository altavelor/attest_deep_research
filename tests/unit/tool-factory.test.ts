import { describe, expect, it, vi } from "vitest";

import {
  bool,
  defineInventoryTool,
  defineTool,
  enumOf,
  int,
  num,
  raw,
  str,
  strArray,
  text,
} from "@application/sources/tools/toolFactory";

describe("tool factory", () => {
  const Tool = defineTool({
    name: "search",
    description: "Search indexed notes.",
    schema: {
      query: str(10, { required: true, description: "Words to search for" }),
      note: text({ maxLength: 20 }),
      limit: int(1, 5, 2),
      score: num({ min: 0, max: 1 }),
      includeArchived: bool(),
      mode: enumOf(["exact", "semantic"], { required: true }),
      paths: strArray(2, 8),
      filter: raw({ type: "object" }),
    },
    execute: async (_deps: { calls: number }, input: Record<string, unknown>) => ({
      ok: true,
      value: input,
    }),
  });

  it("exposes a complete JSON schema and parses valid values", () => {
    const tool = new Tool({ calls: 0 });

    expect(tool.definition.function.parameters).toEqual({
      type: "object",
      additionalProperties: false,
      required: ["query", "mode"],
      properties: {
        query: { type: "string", maxLength: 10, description: "Words to search for" },
        note: { type: "string", maxLength: 20 },
        limit: { type: "integer", minimum: 1, maximum: 5 },
        score: { type: "number", minimum: 0, maximum: 1 },
        includeArchived: { type: "boolean" },
        mode: { type: "string", enum: ["exact", "semantic"] },
        paths: { type: "array", items: { type: "string", maxLength: 8 }, maxItems: 2 },
        filter: { type: "object" },
      },
    });
    expect(
      tool.parseInput({
        query: " notes ",
        note: "verbatim text",
        limit: 50,
        score: -1,
        includeArchived: true,
        mode: "semantic",
        paths: [" Notes ", "Ideas"],
        filter: { tag: "research" },
      }),
    ).toEqual({
      ok: true,
      value: {
        query: "notes",
        note: "verbatim text",
        limit: 5,
        score: 0,
        includeArchived: true,
        mode: "semantic",
        paths: ["Notes", "Ideas"],
        filter: { tag: "research" },
      },
    });
  });

  it("rejects unknown, required, and malformed fields while defaulting invalid limits", () => {
    const tool = new Tool({ calls: 0 });

    expect(tool.parseInput({ query: "notes", mode: "exact", extra: true })).toMatchObject({
      ok: false,
      error: { code: "unknown-property" },
    });
    expect(tool.parseInput({ query: "notes" })).toMatchObject({
      ok: false,
      error: { code: "invalid-input" },
    });
    expect(tool.parseInput({ query: "   ", mode: "exact" })).toMatchObject({
      ok: false,
      error: { code: "invalid-input" },
    });
    expect(
      tool.parseInput({ query: "notes", mode: "exact", paths: ["too-long-path"] }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid-input" },
    });
    expect(tool.parseInput({ query: "notes", mode: "exact", limit: 1.5 })).toEqual({
      ok: true,
      value: { query: "notes", limit: 2, mode: "exact" },
    });
  });

  it("turns unavailable and failing inventory operations into stable tool failures", async () => {
    const run = vi.fn(async () => ["result"]);
    const Tool = defineInventoryTool({
      name: "list_sources",
      description: "List sources.",
      schema: {},
      capability: "listIndexSources",
      errorCode: "index-read-failed",
      errorMessage: "Could not read index.",
      run,
      wrap: (result) => ({ result }),
    });

    const unsupported = new Tool({} as never);
    await expect(unsupported.execute({}, {} as never)).resolves.toMatchObject({
      ok: false,
      error: { code: "index-inventory-unsupported" },
    });

    const failing = new Tool({ listIndexSources: vi.fn() } as never);
    run.mockRejectedValueOnce(new Error("offline"));
    await expect(failing.execute({}, {} as never)).resolves.toMatchObject({
      ok: false,
      error: { code: "index-read-failed", retryable: true },
    });
  });
});
