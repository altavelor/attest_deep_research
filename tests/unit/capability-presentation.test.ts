import {
  applyCapabilityVerificationState,
  capabilityTags,
  deriveCapabilityVerificationState,
  formatEffortLabel,
  reasoningVerified,
  resolvedAgenticModeAfterProbe,
  toolsVerified,
} from "@adapters/settings";
import { createToolCapabilitySettings, withProbeResults } from "@adapters/settings";

describe("capability presentation helpers", () => {
  const profile = () => ({
    id: "chat",
    name: "Chat",
    serverProfileId: "server",
    modelName: "model",
    toolsEnabled: true,
    noteMutationAccess: true,
    reasoning: { mode: "auto" as const, summary: "off" as const },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  it("only treats probe-owned successful results as verified", () => {
    expect(
      toolsVerified({
        capabilities: {
          chat: true,
          embeddings: false,
          detectionSource: "probe",
          toolCalling: withProbeResults(createToolCapabilitySettings(), { calls: true }),
        },
      }),
    ).toBe(true);
    expect(
      toolsVerified({
        capabilities: {
          chat: true,
          embeddings: false,
          detectionSource: "probe",
          toolCalling: createToolCapabilitySettings(true),
        },
      }),
    ).toBe(false);
    expect(
      reasoningVerified({
        source: "probe",
        responses: true,
        continuation: true,
        summary: false,
        efforts: [],
      }),
    ).toBe(true);
    expect(
      reasoningVerified({
        source: "metadata",
        responses: true,
        continuation: true,
        summary: false,
        efforts: [],
      }),
    ).toBe(false);
  });

  it("derives chat tags and title-cases efforts", () => {
    expect(capabilityTags(profile())).toEqual(["Instant"]);
    expect(
      capabilityTags({
        ...profile(),
        reasoningCapabilities: {
          source: "probe",
          responses: true,
          continuation: true,
          summary: false,
          efforts: [],
        },
        capabilities: { tools: true, chat: true, embeddings: false, detectionSource: "probe" },
      }),
    ).toEqual(["Agent", "Tools"]);
    expect(formatEffortLabel("minimal")).toBe("Minimal");
  });

  it("turns legacy auto agent mode on after a successful reasoning probe", () => {
    expect(
      resolvedAgenticModeAfterProbe("auto", {
        source: "probe",
        responses: true,
        continuation: true,
        summary: false,
        efforts: [],
      }),
    ).toBe("on");
    expect(
      resolvedAgenticModeAfterProbe("off", {
        source: "probe",
        responses: true,
        continuation: true,
        summary: false,
        efforts: [],
      }),
    ).toBe("off");
  });

  it("keeps a completed channel result when the other probe fails", () => {
    const verifiedTools = applyCapabilityVerificationState(
      deriveCapabilityVerificationState({
        ...profile(),
        capabilities: {
          chat: true,
          embeddings: false,
          detectionSource: "probe",
          toolCalling: withProbeResults(createToolCapabilitySettings(), { calls: true }),
        },
      }),
      { agent: "testing" },
    );

    expect(applyCapabilityVerificationState(verifiedTools, { agent: "failed" })).toEqual({
      tools: "verified",
      agent: "failed",
    });
  });
});
