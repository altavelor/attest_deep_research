import { runAgentLoop } from "@core/agent";
import { isIxplorerError } from "@core/errors";
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

  it("reports the stop reason through an IxplorerError and disposes the continuation", async () => {
    const dispose = vi.fn();
    const error = await runAgentLoop({
      modelRound: provider([
        {
          items: [],
          stopReason: "length",
          continuation: { provider: "openai-compatible", dispose },
        },
      ]),
      model: "m",
      messages: [],
      tools: [],
      executeTool: async () => ({ ok: true, result: "{}" }),
    }).catch((thrown: unknown) => thrown);

    expect(isIxplorerError(error)).toBe(true);
    expect(error).toMatchObject({
      code: "MODEL_PROVIDER_UNAVAILABLE",
      details: { reason: "model-round-length" },
    });
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("executes only the calls within maxToolCallsPerRound and skips the rest", async () => {
    const executed: string[] = [];
    const result = await runAgentLoop({
      modelRound: provider([
        {
          items: [
            { type: "toolCall", call: { id: "1", name: "a", arguments: {} } },
            { type: "toolCall", call: { id: "2", name: "b", arguments: {} } },
            { type: "toolCall", call: { id: "3", name: "c", arguments: {} } },
          ],
          stopReason: "tool_calls",
        },
        { items: [{ type: "text", text: "done" }], stopReason: "complete" },
      ]),
      model: "m",
      messages: [],
      tools: [],
      maxToolCallsPerRound: 1,
      executeTool: async (call) => {
        executed.push(call.name);
        return { ok: true, result: "{}" };
      },
    });

    expect(executed).toEqual(["a"]);
    expect(result.diagnostics.map((entry) => [entry.name, entry.status, entry.reason])).toEqual([
      ["a", "success", undefined],
      ["b", "skipped", "tool-call-limit-exceeded"],
      ["c", "skipped", "tool-call-limit-exceeded"],
    ]);
  });

  it("truncates an oversized tool result and then skips calls past the char budget", async () => {
    const executed: string[] = [];
    const result = await runAgentLoop({
      modelRound: provider([
        {
          items: [{ type: "toolCall", call: { id: "1", name: "big", arguments: {} } }],
          stopReason: "tool_calls",
        },
        {
          items: [{ type: "toolCall", call: { id: "2", name: "mid", arguments: {} } }],
          stopReason: "tool_calls",
        },
        {
          items: [{ type: "toolCall", call: { id: "3", name: "next", arguments: {} } }],
          stopReason: "tool_calls",
        },
        { items: [{ type: "text", text: "done" }], stopReason: "complete" },
      ]),
      model: "m",
      messages: [],
      tools: [],
      maxTotalResultChars: 200,
      executeTool: async (call) => {
        executed.push(call.name);
        return { ok: true, result: "x".repeat(500) };
      },
    });

    expect(executed).toEqual(["big", "mid"]);
    expect(result.diagnostics[0]).toMatchObject({
      name: "big",
      status: "success",
      reason: "tool-output-truncated",
    });
    expect(result.diagnostics[2]).toMatchObject({
      name: "next",
      status: "skipped",
      reason: "tool-output-budget-exceeded",
    });
  });

  it("propagates an abort raised between rounds and disposes the continuation", async () => {
    const controller = new AbortController();
    const dispose = vi.fn();
    let round = 0;
    const modelRound: ModelRoundProvider = {
      async listModels() {
        return [];
      },
      async runRound(request) {
        round += 1;
        if (request.signal?.aborted) {
          throw new DOMException("The operation was aborted.", "AbortError");
        }
        return {
          items: [{ type: "toolCall", call: { id: String(round), name: "a", arguments: {} } }],
          stopReason: "tool_calls",
          continuation: { provider: "openai-compatible", dispose },
        };
      },
    };

    const executed: string[] = [];
    await expect(
      runAgentLoop({
        modelRound,
        model: "m",
        messages: [],
        tools: [],
        signal: controller.signal,
        executeTool: async (call) => {
          executed.push(call.id);
          controller.abort();
          return { ok: true, result: "{}" };
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(executed).toEqual(["1"]);
    expect(round).toBe(2);
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
