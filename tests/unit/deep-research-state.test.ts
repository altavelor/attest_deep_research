import { validateResearchSection } from "@core/research/deepResearch";
import { pendingResearch } from "../support/deepResearch";

describe("deep research section validation", () => {
  it("accepts the current schema and rejects an unknown one as unreadable", () => {
    const section = { schema: 1, active: pendingResearch(), history: [] };
    expect(validateResearchSection(section).ok).toBe(true);
    expect(validateResearchSection({ ...section, schema: 2 })).toEqual({
      ok: false,
      message: "The research state has an unknown schema.",
    });
  });
});
