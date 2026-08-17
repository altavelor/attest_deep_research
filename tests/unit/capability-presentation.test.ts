import {
  applyCapabilityVerificationState,
  capabilityVerificationIdentity,
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

  it("treats probe results and explicitly advertised metadata as supported capabilities", () => {
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
          detectionSource: "metadata",
          toolCalling: {
            ...createToolCapabilitySettings(true),
            advertised: { calls: true },
          },
        },
      }),
    ).toBe(true);
    expect(
      toolsVerified({
        capabilities: {
          chat: true,
          embeddings: false,
          detectionSource: "metadata",
          toolCalling: createToolCapabilitySettings(true),
        },
      }),
    ).toBe(false);
    expect(
      toolsVerified({
        capabilities: {
          chat: true,
          embeddings: false,
          detectionSource: "format-default",
          toolCalling: createToolCapabilitySettings(false),
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
        responses: false,
        continuation: false,
        summary: false,
        efforts: ["low", "high"],
      }),
    ).toBe(true);
    expect(
      reasoningVerified({
        source: "metadata",
        responses: false,
        continuation: false,
        summary: false,
        efforts: [],
      }),
    ).toBe(false);
    expect(
      reasoningVerified({
        source: "probe",
        responses: false,
        continuation: false,
        summary: false,
        efforts: ["low"],
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

  it("changes the verification identity when a profile changes model", () => {
    expect(capabilityVerificationIdentity(profile())).not.toBe(
      capabilityVerificationIdentity({ ...profile(), modelName: "other-model" }),
    );
  });
});
