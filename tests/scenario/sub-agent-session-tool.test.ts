import { describe, expect, it } from "vitest";

import { createResearchToolRegistry } from "@adapters/research-tools/createResearchToolRegistry";
import type { SubAgentParentRun } from "@application/ports/subAgent";
import { SubAgentParentCoordinator } from "@application/use-cases/sub-agent";
import { ThinkingResearchRunner } from "@application/use-cases/research/ThinkingResearchRunner";
import { subAgentRoundHooks } from "@application/use-cases/research/subAgentRoundHooks";
import type { ModelRoundResult } from "@core/agent";
import { summarizeSubAgentTelemetry, type ResearchExecutionPolicy } from "@core/research";
import { eventually } from "../support/async";
import { FakeSearchProvider, scriptedModelRounds } from "../support/researchFakes";
import { childEvidence, executionResult, importHarness } from "../support/subAgentSessions";

const POLICY: ResearchExecutionPolicy = {
  strategy: "thinking",
  reason: "thinking-eligible",
  requiredTools: [],
  bootstrapChoice: { type: "auto" },
  parallelToolCalls: true,
  supportsSpecificChoice: true,
};

function toolRound(name: string, args: Record<string, unknown>): ModelRoundResult {
  return {
    items: [{ type: "toolCall", call: { id: "text_call_0", name, arguments: args } }],
    stopReason: "tool_calls",
  };
}

function textRound(text: string): ModelRoundResult {
  return { items: [{ type: "text", text }], stopReason: "complete" };
}

describe("session-backed run_subagent in a Thinking loop", () => {
  it("returns receipts at once and delivers committed results with aliases at a round boundary", async () => {
    const harness = importHarness();
    const delegator = harness.delegator();
    const coordinator = new SubAgentParentCoordinator({
      delegator,
      host: harness.manager,
      parentRunId: "parent-1",
    });
    const parent: SubAgentParentRun = {
      parentRunId: "parent-1",
      coordinator,
      resolver: harness.bridge,
      bindExecution: () => undefined,
      attachEvidence: () => undefined,
    };
    const created = createResearchToolRegistry({
      availability: {
        searchMode: "webOnly",
        noteAccess: false,
        activeFileAccess: false,
        noteMutationAccess: false,
        retrieverAvailable: false,
        webProviderAvailable: true,
      },
      searchProvider: new FakeSearchProvider([]),
      subAgentDelegator: delegator,
      subAgentParent: parent,
    });
    const script: (() => ModelRoundResult)[] = [
      () => toolRound("run_subagent", { task: "Investigate A" }),
      () => toolRound("run_subagent", { task: "Investigate B" }),
      () => toolRound("search_web", { query: "own lookup" }),
      () => textRound("Draft while agents work"),
      () =>
        toolRound("get_subagent_result", {
          sessionId: harness.execution.requests[0]!.sessionId,
          runId: harness.execution.requests[0]!.runId,
        }),
      () => textRound("Final"),
    ];
    const model = scriptedModelRounds((_request, index) => script[index - 1]!());

    const running = new ThinkingResearchRunner({
      modelRound: model,
      model: "m",
      messages: [{ role: "user", content: "Question" }],
      tools: created.tools,
      policy: POLICY,
      roundHooks: subAgentRoundHooks(parent, created.evidence),
    }).run();
    await eventually(() => expect(model.requests).toHaveLength(4));

    const runIds = harness.execution.requests.map((request) => request.runId);
    expect(new Set(runIds).size).toBe(2);
    harness.execution.finish(0, { ...executionResult("A [w1]"), evidence: [childEvidence("w1")] });
    harness.execution.finish(1, { ...executionResult("B [w2]"), evidence: [childEvidence("w2")] });
    const result = await running;

    const messages = model.requests.at(-1)!.messages;
    const delivered = messages.findIndex(
      (message) => message.role === "user" && message !== messages[0],
    );
    const delivery = messages[delivered];
    expect(messages[delivered - 1]).toMatchObject({
      role: "assistant",
      content: "Draft while agents work",
    });
    expect(String(delivery?.content)).toContain("untrusted data");
    const aliases = created.evidence.snapshot().evidence.map((chunk) => chunk.id);
    expect(aliases).toHaveLength(2);
    expect(aliases.every((id) => id.startsWith("subagent:import-"))).toBe(true);
    expect(String(delivery?.content)).toContain(aliases[0]);
    expect(harness.chat.attempts).toBe(2);
    expect(harness.execution.requests).toHaveLength(2);
    expect(result.ok).toBe(true);
    expect(summarizeSubAgentTelemetry(result.diagnostics).subAgents).toMatchObject({ count: 2 });
    expect(model.requests).toHaveLength(6);
    const diagnostics = JSON.stringify([result.promptRounds, result.diagnostics]);
    expect(diagnostics).not.toContain("untrusted data");
    expect(
      result.diagnostics.flatMap((call) =>
        call.name === "search_web" ? [] : [call.resultPreview],
      ),
    ).toEqual(Array(3).fill("[withheld sub-agent output]"));
  });
});
