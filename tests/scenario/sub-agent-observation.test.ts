import { describe, expect, it } from "vitest";

import { createResearchToolRegistry } from "@adapters/research-tools/createResearchToolRegistry";
import { SubAgentRunner } from "@application/use-cases/research/sub-agent/SubAgentRunner";
import { SubAgentExecutionAdapter } from "@application/use-cases/sub-agent";
import { redactSensitiveData } from "@shared";
import { eventually } from "../support/async";
import { webSource } from "../support/factories";
import { FakeSearchProvider, scriptedModelRounds } from "../support/researchFakes";
import { AT, importHarness, launchChild } from "../support/subAgentSessions";

describe("sub-agent observation through the execution adapter", () => {
  it("records the first request, model, usage, tool payloads and imported evidence of a real runner", async () => {
    const modelRound = scriptedModelRounds((_request, index) =>
      index === 1
        ? {
            items: [
              {
                type: "toolCall",
                call: { id: "call-1", name: "search_web", arguments: { query: "alpha", limit: 3 } },
              },
            ],
            stopReason: "tool_calls",
            usage: {
              inputTokens: 100,
              outputTokens: 20,
              reasoningTokens: 5,
              cachedInputTokens: 30,
            },
          }
        : {
            items: [{ type: "text", text: "Final answer." }],
            stopReason: "complete",
            usage: {
              inputTokens: 300,
              outputTokens: 40,
              reasoningTokens: 0,
              cachedInputTokens: 10,
            },
          },
    );
    const searchProvider = new FakeSearchProvider([
      {
        source: webSource("https://e.com/x"),
        extractedText: "Alpha facts",
        rank: 1,
        query: "alpha",
      },
    ]);
    const model = { profileId: "p-1", providerId: "openai", modelId: "m", label: "Model M" };
    const execution = new SubAgentExecutionAdapter({
      selectModel: () => ({ model, modelRound }),
      createRunner: (round) =>
        new SubAgentRunner({
          toolsetFactory: createResearchToolRegistry,
          searchProvider,
          modelRound: round,
          model: "m",
        }),
      now: () => new Date(AT),
    });
    const harness = importHarness({ execution, redact: (text) => redactSensitiveData(text) });
    harness.probes.debug = true;
    const { session, receipt } = await launchChild(
      harness.delegator(),
      "alpha",
      "Investigate alpha",
    );
    const inspection = harness.manager.inspection();
    await eventually(async () =>
      expect((await inspection.getSession(session.subAgentSessionId))?.card.status).toBe("ready"),
    );

    const detail = (await inspection.getSession(session.subAgentSessionId))!;
    const sent = modelRound.requests[0].messages;
    expect(detail.initialPrompts[0].state).toBe("captured");
    const captured = detail.initialPrompts[0].messages;
    expect(captured.map((message) => message.role)).toEqual(["system", "system", "user"]);
    expect(captured).toEqual(
      sent.slice(0, 3).map((message) => ({ role: message.role, content: message.content })),
    );
    expect(detail.card.model).toEqual(model);
    expect(detail.card).toMatchObject({ usageIncomplete: false });
    expect(detail.card.usage).toMatchObject({
      source: "provider",
      inputTokens: 400,
      outputTokens: 60,
      totalTokens: 460,
      reasoningTokens: 5,
      cachedInputTokens: 40,
      requestCount: 2,
    });
    expect(detail.lifetime).toHaveLength(1);
    expect(detail.lifetime[0]).toMatchObject({
      name: "search_web",
      status: "complete",
      args: { query: "alpha", limit: 3 },
      payloadState: "captured",
    });
    expect(detail.lifetime[0].resultJson).toContain("https://e.com/x");
    const result = await harness.delegator().getResult(session.subAgentSessionId, receipt.runId);
    expect(result.state === "completed" && result.outcome.evidence).toHaveLength(1);
  });
});
