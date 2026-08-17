import {
  canProbeToolCapabilities,
  createToolCapabilitySettings,
  describeToolCapability,
  resolveToolCapabilities,
  withProbeResults,
} from "@adapters/settings";

describe("tool capability resolution", () => {
  it("uses conservative format defaults", () => {
    expect(resolveToolCapabilities(createToolCapabilitySettings(true))).toEqual({
      capabilities: {
        calls: true,
        choiceRequired: false,
        choiceSpecific: false,
        parallelCalls: false,
      },
      provenance: {
        calls: "format-default",
        choiceRequired: "format-default",
        choiceSpecific: "format-default",
        parallelCalls: "format-default",
      },
    });
  });

  it("resolves probe over format default per flag", () => {
    const settings = createToolCapabilitySettings(false);
    settings.probe = { calls: true, choiceRequired: true, choiceSpecific: false };
    expect(resolveToolCapabilities(settings)).toEqual({
      capabilities: {
        calls: true,
        choiceRequired: true,
        choiceSpecific: false,
        parallelCalls: false,
      },
      provenance: {
        calls: "probe",
        choiceRequired: "probe",
        choiceSpecific: "probe",
        parallelCalls: "format-default",
      },
    });
  });

  it("makes probe results authoritative (no manual override can shadow them)", () => {
    const updated = withProbeResults(createToolCapabilitySettings(false), {
      calls: true,
      choiceRequired: true,
      choiceSpecific: true,
    });
    expect(resolveToolCapabilities(updated).capabilities).toMatchObject({
      calls: true,
      choiceRequired: true,
      choiceSpecific: true,
    });
  });

  it("preserves provider-advertised capabilities when applying a probe result", () => {
    const updated = withProbeResults(
      { ...createToolCapabilitySettings(false), advertised: { calls: true } },
      { calls: false },
    );

    expect(updated).toMatchObject({
      advertised: { calls: true },
      probe: { calls: false },
    });
  });

  it("allows probing a new unsaved profile once server and model are selected", () => {
    expect(
      canProbeToolCapabilities({
        server: { id: "new-server" },
        modelName: "openai/gpt-oss-120b:free",
        probe: async () => ({ calls: true }),
      }),
    ).toBe(true);
  });

  it("describes newly detected capability state immediately", () => {
    const settings = withProbeResults(createToolCapabilitySettings(false), {
      calls: true,
      choiceRequired: true,
      choiceSpecific: true,
    });

    expect(describeToolCapability(settings, "choiceRequired")).toBe(
      "Needed by thinking research. Current: enabled (probe).",
    );
  });
});
