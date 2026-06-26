import { InlineReasoningParser } from "../../src/adapters/model-provider/chat/InlineReasoningParser";

function parse(chunks: string[]): Array<{ type: string; text?: string }> {
  const parser = new InlineReasoningParser();
  return [...chunks.flatMap((chunk) => parser.push(chunk)), ...parser.finish()].map((event) =>
    "text" in event ? { type: event.type, text: event.text } : { type: event.type },
  );
}

describe("InlineReasoningParser", () => {
  it("separates reasoning tags split across arbitrary chunks", () => {
    expect(parse(["<thi", "nk>plan", " carefully</th", "ink>Final"])).toEqual([
      { type: "reasoning-start" },
      { type: "reasoning-delta", text: "plan" },
      { type: "reasoning-delta", text: " carefully" },
      { type: "reasoning-end" },
      { type: "text-delta", text: "Final" },
    ]);
  });

  it("supports configured analysis tags and preserves ordinary XML", () => {
    const parser = new InlineReasoningParser({ tagPairs: [["<analysis>", "</analysis>"]] });
    expect([
      ...parser.push("<answer>visible</answer><analysis>hidden</analysis>done"),
      ...parser.finish(),
    ]).toMatchObject([
      { type: "text-delta", text: "<answer>visible</answer>" },
      { type: "reasoning-start" },
      { type: "reasoning-delta", text: "hidden" },
      { type: "reasoning-end" },
      { type: "text-delta", text: "done" },
    ]);
  });

  it("fails open for an incomplete opening tag", () => {
    const events = parse(["answer <thi"]);
    expect(events.map((event) => event.type)).toEqual(["text-delta", "text-delta"]);
    expect(events.map((event) => event.text ?? "").join("")).toBe("answer <thi");
  });

  it("assigns a distinct segment id to each reasoning block", () => {
    const events = new InlineReasoningParser().push("<think>one</think>x<think>two</think>");
    expect(
      events.filter((event) => event.type === "reasoning-start").map((event) => event.segmentId),
    ).toEqual(["reasoning-inline-0", "reasoning-inline-0-1"]);
  });
});
