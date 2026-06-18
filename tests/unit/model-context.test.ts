import { contextLengthInputAfterDiscovery } from "../../src/settings/modelContext";

describe("contextLengthInputAfterDiscovery", () => {
  it("uses discovered model metadata when available", () => {
    expect(contextLengthInputAfterDiscovery("8192", 32768)).toBe("32768");
  });

  it("preserves manual input when metadata is unavailable", () => {
    expect(contextLengthInputAfterDiscovery("8192", undefined)).toBe("8192");
  });
});
