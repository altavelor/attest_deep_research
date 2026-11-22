import {
  ResearchBudgetPermits,
  ResearchScopeRouter,
} from "@application/use-cases/research/deep-research";
import {
  ResearchBudgetOwner,
  branchPath,
  presetLimits,
  researchScopeId,
} from "@core/research/deepResearch";

const limits = presetLimits("balanced");

function permits(owner = new ResearchBudgetOwner(limits, () => 0, 2)) {
  owner.open(null);
  return new ResearchBudgetPermits({
    researchId: "research-1",
    owner,
    sessionCeiling: limits.childSessions,
    sessionByBranch: {},
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    onClosed: () => undefined,
  });
}

describe("deep research budget scopes", () => {
  it("refuses unknown and foreign scopes instead of treating them as local", async () => {
    const router = new ResearchScopeRouter();
    router.attach(permits());
    for (const scope of ["scope-1", researchScopeId("research-2", "branch-1")]) {
      await expect(router.beginSessionRegistration(scope, "c-1"), scope).rejects.toThrow(
        "The budget scope belongs to no active research of this chat.",
      );
    }
    const own = await router.beginSessionRegistration(
      researchScopeId("research-1", "branch-1"),
      "c-1",
    );
    expect(own.type).toBe("registered");
  });

  it("grants one execution permit per open allocation and replays it for the same key", async () => {
    const owner = new ResearchBudgetOwner(limits, () => 0, 2);
    const port = permits(owner);
    owner.allocate("w-1", "branch-1");
    const scope = researchScopeId("research-1", "branch-1");

    const first = await port.beginExecution(scope, "key-1");
    const replay = await port.beginExecution(scope, "key-1");
    const second = await port.beginExecution(scope, "key-2");

    expect(replay).toEqual(first);
    expect(first.type).toBe("granted");
    expect(second.type).toBe("work-denied");
    expect(owner.snapshot().consumed.branchAttempts).toBe(1);
  });

  it("lets the first cleanup claim of each scope win without suppressing a sibling scope", async () => {
    const owner = new ResearchBudgetOwner({ ...limits, evidenceItemsTotal: 1 }, () => 0, 2);
    const port = permits(owner);
    const [a, b] = ["branch-1", "branch-2"].map((id) => researchScopeId("research-1", id));
    const denied = await port.reserve(a!, {
      actionKey: "append-1",
      action: "evidence-append",
      units: { evidenceItems: 2 },
    });
    const closureId = denied.type === "denied" ? denied.closureId : "none";

    const claims = [
      await port.claimClosureCleanup(a!, closureId),
      await port.claimClosureCleanup(b!, closureId),
      await port.claimClosureCleanup(a!, closureId),
    ];

    expect(claims).toEqual([true, true, false]);
  });
});

describe("deep research branch path", () => {
  it("delegates up to the session ceiling and runs a new branch on the main path beyond it", () => {
    const sessions = { "branch-1": "s-1" };
    expect(branchPath(sessions, "branch-2", 0, 2)).toBe("sub-agent");
    expect(branchPath(sessions, "branch-2", 1, 2)).toBe("main");
    expect(branchPath(sessions, "branch-1", 1, 2)).toBe("sub-agent");
  });

  it("runs every branch on the main path with a ceiling of zero", () => {
    expect(branchPath({}, "branch-1", 0, 0)).toBe("main");
  });
});
