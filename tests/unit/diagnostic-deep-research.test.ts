import { renderDeepResearch } from "@apps/obsidian/ui/diagnostics/html/deepResearch";

describe("deep research diagnostics card", () => {
  it("lists the tool counts of each run with the names escaped", () => {
    const html = renderDeepResearch({
      researchId: "r-1",
      turnKind: "continue",
      phaseBefore: null,
      phaseAfter: null,
      terminalReason: null,
      stopReason: null,
      plan: null,
      budget: null,
      works: [
        {
          workId: "w-1",
          kind: "gather",
          branchId: "branch-1",
          runner: "main",
          state: "completed",
          terminalReason: null,
          attempts: 1,
          findingChars: 10,
          citationTokens: 1,
          partial: false,
          runs: [
            {
              attempt: 1,
              path: "main",
              rounds: 2,
              searches: 1,
              evidenceItems: 3,
              tools: { search_web: 1, find_in_pages: 4, "<b>": 2 },
              allocatedRounds: 3,
              allocatedSearches: 3,
            },
          ],
        },
      ],
      omittedWorks: 0,
      hypotheses: [],
      cycleDecisions: [],
    });
    expect(html).toContain("tools search_web 1, find_in_pages 4, &lt;b&gt; 2");
  });
});
