import {
  applyDecision,
  applyPlanEdit,
  parsePlanDecisionPayload,
  parsePlanDraft,
  presetLimits,
  validatePlan,
} from "@core/research/deepResearch";
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

  it("limits the enabled branches to the preset and not the disabled ones", () => {
    const branches = Array.from({ length: 4 }, (_, index) => researchBranch(index + 1));
    expect(validatePlan(researchPlan(branches, "conservative"))).toBe(
      "A plan runs at most 3 enabled branches; disable or remove one.",
    );
    branches[3] = researchBranch(4, { enabled: false });
    expect(validatePlan(researchPlan(branches, "conservative"))).toBeNull();
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

  it("removes a branch that others depend on and records its objective as omitted", () => {
    const plan = researchPlan([
      researchBranch(1),
      researchBranch(2, { objectives: [], dependsOn: ["branch-1"] }),
      researchBranch(3, { objectives: [], dependsOn: ["branch-1", "branch-2"] }),
      researchBranch(4, { enabled: false, objectives: [], dependsOn: ["branch-1"] }),
    ]);
    const removed = applyPlanEdit(plan, { branches: [{ branchId: "branch-1", enabled: false }] });
    if (!removed.ok) throw new Error(removed.message);
    expect(removed.plan.branches.map((branch) => branch.dependsOn)).toEqual([
      [],
      [],
      ["branch-2"],
      ["branch-1"],
    ]);
    expect(removed.plan.knownOmissions).toEqual(["Objective"]);
    const restored = applyPlanEdit(removed.plan, {
      branches: [{ branchId: "branch-1", enabled: true }],
    });
    expect(restored.ok && restored.plan.knownOmissions).toEqual([]);
  });

  it("removes, reprioritises, adds and reorders branches in one edit", () => {
    const plan = researchPlan([
      researchBranch(1),
      researchBranch(2, { dependsOn: ["branch-1"] }),
      researchBranch(3, { sourceScope: "webOnly" }),
    ]);
    const edit = {
      removed: ["branch-1"],
      branches: [{ branchId: "branch-3", priority: "optional" as const }],
      added: [{ title: " Costs ", task: "Compare costs" }],
      order: ["branch-3", 0, "branch-2"],
    };
    const edited = applyPlanEdit(plan, edit);
    if (!edited.ok) throw new Error(edited.message);
    expect(edited.plan.branches.map((branch) => branch.branchId)).toEqual([
      "branch-3",
      "branch-4",
      "branch-2",
    ]);
    expect(edited.plan.branches[0]!.priority).toBe("optional");
    expect(edited.plan.branches[1]).toEqual({
      branchId: "branch-4",
      title: "Costs",
      task: "Compare costs",
      expectedOutput: "",
      priority: "optional",
      enabled: true,
      objectives: [],
      sourceScope: "indexAndWeb",
      dependsOn: [],
    });
    expect(edited.plan.branches[2]!.dependsOn).toEqual([]);
    expect(applyPlanEdit(plan, { ...edit, order: ["branch-3", 0, 0] })).toMatchObject({
      ok: false,
      message: "The edit order does not match the branches.",
    });
    expect(applyPlanEdit(plan, { added: [{ title: "Costs", task: " " }] })).toMatchObject({
      ok: false,
      message: "Every branch needs a title and a task.",
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

describe("deep research untrusted plan input", () => {
  const draftContext = {
    planId: "plan-1",
    preset: "balanced" as const,
    chatScope: "indexOnly" as const,
    generationsUsed: 1,
  };

  it("keeps host scope, limits and identifiers and bounds the text of a model plan", () => {
    const reply = JSON.stringify({
      objectives: ["Goal"],
      limits: { searchesTotal: 999 },
      branches: [
        {
          branchId: "evil",
          title: "T".repeat(500),
          task: "Do",
          sourceScope: "webOnly",
          objectives: [1],
          limits: {},
        },
      ],
    });
    const parsed = parsePlanDraft(reply, draftContext);
    if (!parsed.ok) throw new Error(parsed.message);
    expect(parsed.value.limits).toEqual(presetLimits("balanced"));
    expect(parsed.value.branches[0]).toMatchObject({
      branchId: "branch-1",
      sourceScope: "indexOnly",
    });
    expect(parsed.value.branches[0]!.title).toHaveLength(200);
  });

  it("resolves objective positions against the list the model sent", () => {
    const reply = JSON.stringify({
      objectives: ["", "First", "First", "Second"],
      branches: [{ title: "T", task: "Do", objectives: [4] }],
    });
    const parsed = parsePlanDraft(reply, draftContext);
    expect(parsed.ok && parsed.value.branches[0]!.objectives).toEqual(["Second"]);
  });

  it("rejects malformed decision payloads and ignores extra fields", () => {
    for (const payload of [
      { action: "launch" },
      { action: "edit", edit: { branches: [{ branchId: "branch-1", enabled: "yes" }] } },
      { action: "edit", edit: { added: [{ title: 1, task: "Do" }] } },
      { action: "edit", edit: { branches: [{ branchId: "branch-1", priority: "high" }] } },
      { action: "edit", edit: { order: [-1] } },
      { action: "regenerate", instruction: "x".repeat(4001) },
    ]) {
      expect(parsePlanDecisionPayload(payload), JSON.stringify(payload).slice(0, 40)).toBeNull();
    }
    expect(
      parsePlanDecisionPayload({
        action: "edit",
        limits: { searchesTotal: 999 },
        edit: { branches: [{ branchId: "branch-1", enabled: false, limits: {} }] },
      }),
    ).toEqual({ action: "edit", edit: { branches: [{ branchId: "branch-1", enabled: false }] } });
    expect(applyPlanEdit(researchPlan(), { branches: [{ branchId: "branch-9" }] })).toEqual({
      ok: false,
      code: "research-invalid-plan",
      message: "The edit names an unknown branch.",
    });
  });
});
