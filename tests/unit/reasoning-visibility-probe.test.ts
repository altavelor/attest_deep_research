import { probeReasoningVisibility } from "@adapters/settings";
import { ChatModelProvider } from "@core/agent";

describe("reasoning visibility probe", () => {
  it("uses one bounded request without tools and reports observed formats", async () => {
    const requests: unknown[] = [];
    const provider: ChatModelProvider = {
      listModels: async () => ["m"],
      async *streamChat(request) {
        requests.push(request);
        yield {
          content: "answer",
          isComplete: true,
          events: [
            { type: "reasoning-start", segmentId: "r", visibility: "text" },
            { type: "reasoning-delta", segmentId: "r", text: "private probe output" },
            { type: "reasoning-end", segmentId: "r" },
            { type: "text-delta", text: "answer" },
            { type: "complete", stopReason: "complete" },
          ],
        };
      },
    };
    await expect(probeReasoningVisibility({ provider, model: "m" })).resolves.toMatchObject({
      visible: true,
      requestCount: 1,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ maxTokens: 128 });
    expect(requests[0]).not.toHaveProperty("tools");
  });
});
