import { readFileSync } from "node:fs";

describe("parallel capability plumbing", () => {
  const sources = {
    ThinkingResearchStrategy: readFileSync(
      "src/application/use-cases/research/strategies/ThinkingResearchStrategy.ts",
      "utf8",
    ),
    SubAgentRunner: readFileSync(
      "src/application/use-cases/research/sub-agent/SubAgentRunner.ts",
      "utf8",
    ),
  };

  it("passes parallelToolCalls from the research strategy policy", () => {
    expect(sources.ThinkingResearchStrategy).toContain(
      "parallelToolCalls: effectivePolicy.parallelToolCalls",
    );
  });

  it("passes parallelToolCalls from the sub-agent policy", () => {
    expect(sources.SubAgentRunner).toContain(
      "parallelToolCalls: SUB_AGENT_POLICY.parallelToolCalls",
    );
  });

  it("routes prompt assembly issues into the run diagnostics", () => {
    expect(sources.ThinkingResearchStrategy).toContain("onAssemblyIssue:");
    expect(sources.ThinkingResearchStrategy).toContain("promptAssemblyIssues");
    expect(sources.ThinkingResearchStrategy).toContain("diagnostics.warnings.push(warning)");
  });

  it("forwards every assembly issue from the builder to its hook", () => {
    const builder = readFileSync("src/core/research/thinkingPrompts.ts", "utf8");
    expect(builder).toContain("for (const issue of assembled.issues)");
    expect(builder).toContain("options.onAssemblyIssue?.(issue)");
  });
});
