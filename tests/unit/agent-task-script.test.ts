import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const agentTaskScript = readFileSync(resolve("scripts/agent-task.sh"), "utf8");

describe("agent-task publishing safeguards", () => {
  it("stops for manual review when the agent leaves changes behind", () => {
    expect(agentTaskScript).toContain('err "Agent left uncommitted changes; not publishing"');
    expect(agentTaskScript).not.toContain("git add -A");
  });

  it("runs a clean install before the required validation", () => {
    expect(agentTaskScript).toContain("if ! npm ci; then");
    expect(agentTaskScript.indexOf("if ! npm ci; then")).toBeLessThan(
      agentTaskScript.indexOf("if ! npm run check; then"),
    );
  });

  it("includes the complete required pull-request report", () => {
    expect(agentTaskScript).toContain("## Changes");
    expect(agentTaskScript).toContain("## Risks");
  });
});
