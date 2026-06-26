import {
  executeResearchTool,
  parseBoundedSearchInput,
  researchToolExecutionPayload,
  ResearchToolHandler,
} from "../../src/application/research/ResearchTools";

describe("research tool contracts", () => {
  it("normalizes a bounded search input and clamps integer limits", () => {
    expect(parseBoundedSearchInput({ query: "  local   models  ", limit: 99 })).toEqual({
      ok: true,
      value: { query: "local models", limit: 5 },
    });
    expect(parseBoundedSearchInput({ query: "local models" })).toEqual({
      ok: true,
      value: { query: "local models", limit: 5 },
    });
  });

  it.each([
    [{}, "missing-query"],
    [{ query: "   " }, "missing-query"],
    [{ query: "x".repeat(241) }, "query-too-long"],
    [{ query: "x", limit: 1.5 }, "invalid-limit"],
    [{ query: "x", limit: "2" }, "invalid-limit"],
    [{ query: "x", extra: true }, "unknown-property"],
  ])("rejects invalid input without executing the handler", async (input, code) => {
    const execute = vi.fn();
    const handler: ResearchToolHandler<{ query: string; limit: number }, { count: number }> = {
      definition: {
        type: "function",
        function: {
          name: "search_index",
          description: "Search",
          parameters: {},
        },
      },
      parseInput: parseBoundedSearchInput,
      execute,
    };

    const result = await executeResearchTool(handler, {
      id: "call-1",
      name: "search_index",
      arguments: input,
    });

    expect(result).toMatchObject({ ok: false, error: { code } });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects a mismatched tool name before execution", async () => {
    const execute = vi.fn();
    const handler: ResearchToolHandler<{ query: string; limit: number }, { count: number }> = {
      definition: {
        type: "function",
        function: { name: "search_index", description: "Search", parameters: {} },
      },
      parseInput: parseBoundedSearchInput,
      execute,
    };

    const result = await executeResearchTool(handler, {
      id: "call-1",
      name: "search_web",
      arguments: { query: "models" },
    });

    expect(result).toMatchObject({ ok: false, error: { code: "invalid-tool-name" } });
    expect(execute).not.toHaveBeenCalled();
  });

  it("serializes new typed output and preserves legacy note payloads", () => {
    expect(
      researchToolExecutionPayload({ ok: true, value: { query: "models", results: [] } }),
    ).toEqual({ ok: true, query: "models", results: [] });
    expect(
      researchToolExecutionPayload({
        ok: true,
        value: { ok: false, reason: "no-active-note" },
      }),
    ).toEqual({ ok: false, reason: "no-active-note" });
    expect(
      researchToolExecutionPayload({
        ok: false,
        error: { code: "failed", message: "Failed.", retryable: false },
      }),
    ).toEqual({
      ok: false,
      error: { code: "failed", message: "Failed.", retryable: false },
    });
  });
});
