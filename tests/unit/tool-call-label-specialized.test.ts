import { resolveResultSummary, toolCallChainLabel } from "@application/research/toolCallLabel";

describe("specialized research tool call labels", () => {
  it("describes URL verification and delegated source mapping work", () => {
    const longTask = "x".repeat(70);

    expect(toolCallChainLabel("check_urls", { urls: ["a", "b", "c"] })).toBe("Checking 3 URLs");
    expect(toolCallChainLabel("check_urls", {})).toBe("Checking URLs");
    expect(toolCallChainLabel("run_subagent", { task: longTask })).toBe(
      `Sub-agent: ${longTask.slice(0, 60)}…`,
    );
    expect(toolCallChainLabel("map_sources", { question: "Which studies disagree?" })).toBe(
      "Fan-out: Which studies disagree?",
    );
    expect(toolCallChainLabel("list_index_urls", { sourcePath: "Papers/overview.md" })).toBe(
      "URLs: Papers/overview.md",
    );
  });

  it("summarizes URL checks, delegated research, and source-map failures", () => {
    expect(
      resolveResultSummary(
        "check_urls",
        JSON.stringify({ value: { results: [{ ok: true }, { ok: false }] } }),
      ),
    ).toBe("1/2 reachable");
    expect(
      resolveResultSummary("run_subagent", JSON.stringify({ value: { sourceCount: 4 } })),
    ).toBe("4 sources");
    expect(
      resolveResultSummary(
        "map_sources",
        JSON.stringify({ value: { rows: [{ ok: true }, { ok: false }] } }),
      ),
    ).toBe("2 docs (1 failed)");
    expect(resolveResultSummary("map_sources", JSON.stringify({ value: {} }))).toBeUndefined();
  });
});
