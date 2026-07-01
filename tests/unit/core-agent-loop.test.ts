// Stage 3: the agent loop runs in core against the ModelRoundProvider port only,
// with no client adapter and no research labeler.
import { runAgentLoop } from "@core/agent";
import type { ModelRoundProvider, ModelRoundResult } from "@core/agent";

function provider(rounds: ModelRoundResult[]): ModelRoundProvider {
  let i = 0;
  return {
    async listModels() {
      return [];
    },
    async runRound() {
      return rounds[Math.min(i++, rounds.length - 1)];
    },
  };
}

describe("core runAgentLoop", () => {
  it("executes a tool call, then completes on a text round", async () => {
    const executed: string[] = [];
    const result = await runAgentLoop({
      modelRound: provider([
        {
          items: [{ type: "toolCall", call: { id: "1", name: "search", arguments: { q: "x" } } }],
          stopReason: "tool_calls",
        },
        { items: [{ type: "text", text: "final answer" }], stopReason: "complete" },
      ]),
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      executeTool: async (call) => {
        executed.push(call.name);
        return { ok: true, result: JSON.stringify({ ok: true, hits: 1 }) };
      },
    });

    expect(executed).toEqual(["search"]);
    expect(result.answerText).toBe("final answer");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({ name: "search", status: "success" });
  });

  it("uses the default labeler (label = tool name) when none injected", async () => {
    const events: string[] = [];
    await runAgentLoop({
      modelRound: provider([
        {
          items: [{ type: "toolCall", call: { id: "1", name: "vault_search", arguments: {} } }],
          stopReason: "tool_calls",
        },
        { items: [{ type: "text", text: "done" }], stopReason: "complete" },
      ]),
      model: "m",
      messages: [],
      tools: [],
      executeTool: async () => ({ ok: true, result: "{}" }),
      onEvent: (e) => {
        if (e.type === "tool-call-start") events.push(e.label);
      },
    });
    expect(events).toEqual(["vault_search"]);
  });

  it("throws on a length/error stop reason", async () => {
    await expect(
      runAgentLoop({
        modelRound: provider([{ items: [], stopReason: "error" }]),
        model: "m",
        messages: [],
        tools: [],
        executeTool: async () => ({ ok: true, result: "{}" }),
      }),
    ).rejects.toThrow();
  });
});
