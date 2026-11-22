import { applyDecision, validatePlan } from "@core/research/deepResearch";
import { pendingResearch, researchBranch, researchPlan } from "../support/deepResearch";

const CONTEXT = { now: "2026-01-02T00:00:00.000Z", nextDecisionId: "decision-2" };

function regenerate(generationsUsed: number) {
  const state = pendingResearch(researchPlan(undefined, "thorough", { generationsUsed }));
  return applyDecision(
    state,
    {
      researchId: state.researchId,
      decisionId: "decision-1",
      expectedRevision: state.revision,
      payload: { action: "regenerate", instruction: null },
    },
    { ...CONTEXT, regenerated: null },
  );
}

describe("deep research plan validity", () => {
  it("rejects a dependency cycle", () => {
    const plan = researchPlan([
      researchBranch(1, { dependsOn: ["branch-2"] }),
      researchBranch(2, { dependsOn: ["branch-1"] }),
    ]);
    expect(validatePlan(plan)).toBe("Branch dependencies form a cycle.");
  });

  it("rejects a ninth branch", () => {
    const plan = researchPlan(Array.from({ length: 9 }, (_, index) => researchBranch(index + 1)));
    expect(validatePlan(plan)).toBe("A plan needs between one and 8 branches.");
  });

  it("rejects an enabled branch depending on a disabled one", () => {
    const plan = researchPlan([
      researchBranch(1, { enabled: false, priority: "optional" }),
      researchBranch(2, { dependsOn: ["branch-1"] }),
    ]);
    expect(validatePlan(plan)).toBe('Branch "Branch 2" depends on a disabled branch.');
  });
});

describe("deep research decisions", () => {
  it("rejects a stale revision and a foreign decision id", () => {
    const state = pendingResearch();
    const decision = {
      researchId: state.researchId,
      decisionId: "decision-1",
      expectedRevision: state.revision,
      payload: { action: "approve" },
    };
    const approved = applyDecision(state, decision, CONTEXT);
    if (!approved.ok) throw new Error(approved.message);
    expect(approved.state.plan?.approvedAt).toBe(CONTEXT.now);
    expect(applyDecision(approved.state, decision, CONTEXT)).toMatchObject({
      ok: false,
      code: "research-stale-decision",
    });
    expect(applyDecision(state, { ...decision, decisionId: "decision-9" }, CONTEXT)).toMatchObject({
      ok: false,
      code: "research-stale-decision",
    });
  });

  it("allows the third generation and consumes it even when it failed", () => {
    const result = regenerate(2);
    expect(result.ok && result.state.plan?.generationsUsed).toBe(3);
  });

  it("refuses a fourth generation", () => {
    expect(regenerate(3)).toMatchObject({
      ok: false,
      code: "research-generation-limit",
      message: "All plan generations are used; edit the plan manually.",
    });
  });
});
