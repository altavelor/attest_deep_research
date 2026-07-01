import { contextLengthFromModelMetadata } from "@adapters/model-provider";

describe("contextLengthFromModelMetadata", () => {
  it.each([
    [{ context_length: 8192 }, 8192],
    [{ max_context_length: 32768 }, 32768],
    [{ context_window: 128000 }, 128000],
    [{ capabilities: { context_length: 65536 } }, 65536],
    [{ model_info: { "llama.context_length": 131072 } }, 131072],
  ])("reads supported provider metadata from %j", (metadata, expected) => {
    expect(contextLengthFromModelMetadata(metadata)).toBe(expected);
  });

  it.each([
    undefined,
    null,
    {},
    { context_length: 0 },
    { max_context_length: -1 },
    { context_window: "8192" },
  ])("ignores missing or invalid provider metadata: %j", (metadata) => {
    expect(contextLengthFromModelMetadata(metadata)).toBeUndefined();
  });
});
