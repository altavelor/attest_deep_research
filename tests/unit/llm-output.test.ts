import {
  collectChatText,
  parseLlmJsonObject,
  type LlmJsonParseDiagnostic,
} from "@shared";

describe("llmOutput", () => {
  it("parses a valid JSON object", () => {
    const diagnostics: LlmJsonParseDiagnostic[] = [];

    expect(
      parseLlmJsonObject('{"queries":["alpha"]}', {
        fallback: { queries: [] },
        validate: isQueriesObject,
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      }),
    ).toEqual({ queries: ["alpha"] });
    expect(diagnostics).toEqual([{ ok: true, inputLength: 21 }]);
  });

  it("extracts a JSON object from surrounding model text", () => {
    expect(
      parseLlmJsonObject('```json\n{"queries":["alpha"]}\n```', {
        fallback: { queries: [] },
        validate: isQueriesObject,
      }),
    ).toEqual({ queries: ["alpha"] });
  });

  it("returns fallback and diagnostic reason for invalid output", () => {
    const diagnostics: LlmJsonParseDiagnostic[] = [];

    expect(
      parseLlmJsonObject("not json", {
        fallback: { queries: [] },
        validate: isQueriesObject,
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      }),
    ).toEqual({ queries: [] });
    expect(diagnostics).toEqual([{ ok: false, reason: "json-not-found", inputLength: 8 }]);
  });

  it("returns fallback when the JSON shape is invalid", () => {
    const diagnostics: LlmJsonParseDiagnostic[] = [];

    expect(
      parseLlmJsonObject('{"queries":"alpha"}', {
        fallback: { queries: [] },
        validate: isQueriesObject,
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      }),
    ).toEqual({ queries: [] });
    expect(diagnostics).toEqual([{ ok: false, reason: "invalid-shape", inputLength: 19 }]);
  });

  it("returns fallback when the output exceeds the input limit", () => {
    const diagnostics: LlmJsonParseDiagnostic[] = [];

    expect(
      parseLlmJsonObject('{"queries":["alpha"]}', {
        fallback: { queries: [] },
        maxInputLength: 10,
        validate: isQueriesObject,
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      }),
    ).toEqual({ queries: [] });
    expect(diagnostics).toEqual([{ ok: false, reason: "output-too-large", inputLength: 21 }]);
  });

  it("collects chat text until completion", async () => {
    await expect(
      collectChatText(
        stream([
          { content: "alpha ", isComplete: false },
          { content: "beta", isComplete: true },
          { content: "ignored", isComplete: false },
        ]),
      ),
    ).resolves.toBe("alpha beta");
  });

  it("bounds collected chat text", async () => {
    await expect(
      collectChatText(
        stream([
          { content: "alpha", isComplete: false },
          { content: " beta", isComplete: true },
        ]),
        { maxLength: 7 },
      ),
    ).resolves.toBe("alpha b");
  });
});

function isQueriesObject(value: unknown): value is { queries: unknown[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { queries?: unknown }).queries)
  );
}

async function* stream(
  chunks: Array<{ content: string; isComplete: boolean }>,
): AsyncIterable<{ content: string; isComplete: boolean }> {
  for (const chunk of chunks) {
    yield chunk;
  }
}
