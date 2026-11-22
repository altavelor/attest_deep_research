import { presetLimits, validateResearchSection } from "@core/research/deepResearch";
import { pendingResearch, researchPlan } from "../support/deepResearch";

const pending = pendingResearch();
const approved = {
  ...pending,
  phase: "gathering",
  pending: null,
  plan: { ...pending.plan!, approvedAt: "2026-01-02T00:00:00.000Z" },
};
const ended = {
  researchId: "research-0",
  question: "Q",
  phase: "cancelled",
  terminalReason: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function section(active: unknown, history: unknown[] = []) {
  return { schema: 1, active, history };
}

describe("deep research section validation", () => {
  it("rejects malformed and inconsistent sections as unreadable", () => {
    const rows: [string, unknown][] = [
      ["unknown schema", { ...section(pending), schema: 2 }],
      ["unsafe revision", section({ ...pending, revision: 2 ** 53 })],
      ["negative revision", section({ ...pending, revision: -1 })],
      ["fractional revision", section({ ...pending, revision: 1.5 })],
      ["unknown phase", section({ ...pending, phase: "dreaming", pending: null })],
      ["inner schema", section({ ...pending, schema: 2 })],
      ["terminal phase as active", section({ ...pending, phase: "completed", pending: null })],
      [
        "history over ten",
        section(
          null,
          Array.from({ length: 11 }, () => ended),
        ),
      ],
      [
        "limits off preset",
        section({
          ...pending,
          plan: { ...pending.plan!, limits: { ...presetLimits("thorough"), searchesTotal: 999 } },
        }),
      ],
      ["decision in planning", section({ ...pending, phase: "planning" })],
      ["plan decision without plan", section({ ...pending, plan: null })],
      [
        "artifact revision off plan",
        section({ ...pending, pending: { ...pending.pending!, artifactRevision: 7 } }),
      ],
      [
        "approved while awaiting",
        section({ ...pending, plan: { ...pending.plan!, approvedAt: "2026-01-02T00:00:00.000Z" } }),
      ],
      ["gathering without approval", section({ ...approved, plan: pending.plan })],
      [
        "unbounded timestamp",
        section({
          ...pending,
          createdAt: "Thursday, January 1, 2026 00:00:00 GMT+0000 (Coordinated Universal Time)",
        }),
      ],
      ["non-terminal phase in history", section(null, [{ ...ended, phase: "gathering" }])],
      ["bad timestamp in history", section(null, [{ ...ended, updatedAt: "yesterday" }])],
      ["over-long history reason", section(null, [{ ...ended, terminalReason: "r".repeat(4001) }])],
      [
        "too many objectives",
        section({
          ...pending,
          plan: researchPlan(undefined, "thorough", {
            objectives: Array.from({ length: 13 }, (_, i) => `O${i}`),
          }),
        }),
      ],
    ];
    for (const [label, value] of rows) {
      expect(validateResearchSection(value).ok, label).toBe(false);
    }
  });

  it("accepts consistent sections and drops unknown keys", () => {
    expect(validateResearchSection(section(approved, [ended])).ok).toBe(true);
    const result = validateResearchSection({
      ...section({ ...pending, extra: 1, plan: { ...pending.plan!, extra: 2 } }, [
        { ...ended, extra: 3 },
      ]),
      extra: 4,
    });
    expect(result.ok && JSON.stringify(result.value)).not.toContain("extra");
  });
});
