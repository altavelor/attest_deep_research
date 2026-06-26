import {
  resolveResponsesProviderPolicy,
  ResponsesPolicyInput,
} from "../../src/adapters/model-provider/chat/ResponsesProviderPolicy";
import { ReasoningCapabilitySettings } from "../../src/adapters/settings/settings";

const capabilities: ReasoningCapabilitySettings = {
  source: "probe",
  responses: true,
  continuation: true,
  summary: true,
  efforts: ["low", "high"],
  requiresEffort: false,
};

function input(overrides: Partial<ResponsesPolicyInput> = {}): ResponsesPolicyInput {
  return {
    apiFormat: "openai-compatible",
    capabilities,
    isCapabilityCurrent: true,
    reasoning: { enabled: false, summary: "off" },
    ...overrides,
  };
}

describe("resolveResponsesProviderPolicy", () => {
  it("returns verified efforts/summary when allowed", () => {
    expect(resolveResponsesProviderPolicy(input())).toEqual({
      efforts: ["low", "high"],
      summary: true,
    });
  });

  it("rejects non-openai-compatible servers", () => {
    expect(() => resolveResponsesProviderPolicy(input({ apiFormat: "ollama" }))).toThrow(
      /OpenAI-compatible/,
    );
  });

  it("rejects when capability detection is missing", () => {
    expect(() => resolveResponsesProviderPolicy(input({ capabilities: undefined }))).toThrow(
      /capability detection/,
    );
  });

  it("rejects a stale capability probe", () => {
    expect(() => resolveResponsesProviderPolicy(input({ isCapabilityCurrent: false }))).toThrow(
      /stale/,
    );
  });

  it("rejects reasoning without verified continuation", () => {
    expect(() =>
      resolveResponsesProviderPolicy(
        input({
          capabilities: { ...capabilities, continuation: false },
          reasoning: { enabled: true, summary: "off" },
        }),
      ),
    ).toThrow(/continuation/);
  });

  it("rejects an unsupported reasoning effort", () => {
    expect(() =>
      resolveResponsesProviderPolicy(
        input({ reasoning: { enabled: true, effort: "ultra", summary: "off" } }),
      ),
    ).toThrow(/effort is not supported/);
  });

  it("rejects auto summary when summaries are unavailable", () => {
    expect(() =>
      resolveResponsesProviderPolicy(
        input({
          capabilities: { ...capabilities, summary: false },
          reasoning: { enabled: true, summary: "auto" },
        }),
      ),
    ).toThrow(/summaries are not supported/);
  });
});
