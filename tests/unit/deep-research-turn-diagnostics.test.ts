import { deepResearchTurnDiagnostics } from "@core/research/deepResearch";
import { gatheringResearch, researchBranch, researchPlan } from "../support/deepResearch";

describe("deep research turn diagnostics", () => {
  it("names the session a running work uses and no session for a finished work without a reference", () => {
    const start = gatheringResearch(
      researchPlan([researchBranch(1), researchBranch(2)], "balanced"),
    );
    const [first, second] = start.executions;
    const after = {
      ...start,
      sessionByBranch: { "branch-1": "session-new", "branch-2": "session-2" },
      executions: [
        { ...first!, path: "sub-agent" as const, state: "running" as const },
        {
          ...second!,
          path: "sub-agent" as const,
          state: "completed" as const,
          finding: { text: "F", citationTokens: [], partial: false },
        },
      ],
    };

    const works = deepResearchTurnDiagnostics({
      turnKind: "continue",
      before: start,
      after,
      runs: new Map(),
    }).works;

    expect(works.map((work) => work.runner)).toEqual([
      "sub-agent session-new",
      "sub-agent unknown",
    ]);
  });
});
