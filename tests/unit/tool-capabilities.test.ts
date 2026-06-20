import {
  canProbeToolCapabilities,
  createToolCapabilitySettings,
  describeToolCapability,
  resolveToolCapabilities,
  withProbeResults,
} from "../../src/settings/toolCapabilities";

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

  it("resolves manual over probe over format default per flag", () => {
    const settings = createToolCapabilitySettings(false);
    settings.probe = { calls: true, choiceRequired: true, choiceSpecific: false };
    settings.manual = { choiceRequired: false, choiceSpecific: true };
    expect(resolveToolCapabilities(settings)).toEqual({
      capabilities: {
        calls: true,
        choiceRequired: false,
        choiceSpecific: true,
        parallelCalls: false,
      },
      provenance: {
        calls: "probe",
        choiceRequired: "manual",
        choiceSpecific: "manual",
        parallelCalls: "format-default",
      },
    });
  });

  it("updates probe results without changing manual overrides", () => {
    const settings = createToolCapabilitySettings(false);
    settings.manual = { choiceRequired: false };
    const updated = withProbeResults(settings, {
      calls: true,
      choiceRequired: true,
      choiceSpecific: true,
    });
    expect(updated.manual).toEqual({ choiceRequired: false });
    expect(resolveToolCapabilities(updated).capabilities).toMatchObject({
      calls: true,
      choiceRequired: false,
      choiceSpecific: true,
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
      "Needed by agentic research. Current: enabled (probe).",
    );
  });
});
