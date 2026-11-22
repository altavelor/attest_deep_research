import {
  USER_OBSERVATION_LIMITATION,
  acceptHypothesisDraft,
  hypothesesSection,
  parseHypothesisProposals,
  validateResearchSection,
  hypothesisClaims,
  nextCycleDecision,
  reduceHypothesis,
  userObservation,
  type ResearchHypothesis,
  type ResearchObservation,
  type ResearchTest,
} from "@core/research/deepResearch";
import { ResearchDiscoveryService } from "@application/use-cases/research/deep-research";
import { suppliedObservation } from "@application/use-cases/research/deep-research/strategyHelpers";
import { runDiscoveryPhase } from "@application/use-cases/research/deep-research/researchDiscoveryPhase";
import { FakeChatModel } from "../support/researchFakes";
import { markdownSource, retrieved } from "../support/factories";
import { gatheringResearch, researchBranch, researchPlan } from "../support/deepResearch";

const hypothesis: ResearchHypothesis = {
  hypothesisId: "h-1",
  revision: 1,
  previousRevision: null,
  branchId: "branch-1",
  claim: "The moon drives tides.",
  alternative: "Wind drives tides.",
  prediction: "Tides follow the lunar cycle.",
  disconfirmation: "Tides ignore the lunar cycle.",
  status: "untested",
  observationIds: ["o-1", "o-2"],
};

function observation(id: string, verdict: ResearchObservation["verdict"]): ResearchObservation {
  return {
    observationId: id,
    testId: "t-1",
    producer: "source",
    citationTokens: ["e1"],
    verdict,
    quote: "Tides follow the moon closely.",
    limitations: [],
    observedAt: null,
    receivedAt: "2026-01-01T00:00:00.000Z",
  };
}

const proposed: ResearchTest = {
  testId: "t-1",
  hypothesisId: "h-1",
  hypothesisRevision: 1,
  kind: "literature-check",
  method: "Check tide tables.",
  status: "proposed",
};

function decide(cycle: number, progressed: boolean) {
  return nextCycleDecision({
    cycle,
    researchCycles: 3,
    budgetClosed: false,
    hypotheses: [hypothesis],
    tests: [proposed],
    progressed,
  });
}

describe("deep research discovery rules", () => {
  it("disconfirms a favoured hypothesis on one contradicting observation", () => {
    const reduced = reduceHypothesis(hypothesis, [
      observation("o-1", "supports"),
      observation("o-2", "contradicts"),
    ]);
    expect(reduced.status).toBe("disconfirmed");
  });

  it("leaves a hypothesis without its own observation untested", () => {
    const reduced = reduceHypothesis({ ...hypothesis, status: "supported" }, [
      observation("o-9", "supports"),
    ]);
    expect(reduced.status).toBe("untested");
  });

  it("rejects a hypothesis without an alternative or a disconfirmation criterion", () => {
    const draft = { ...hypothesis };
    expect(acceptHypothesisDraft({ ...draft, alternative: " " })).toBeNull();
    expect(acceptHypothesisDraft({ ...draft, disconfirmation: undefined })).toBeNull();
    expect(acceptHypothesisDraft(draft)).not.toBeNull();
  });

  it("continues a progressing cycle inside the cycle cap", () => {
    expect(decide(2, true)).toBe("continue");
  });

  it("stops as exhausted at the cycle cap", () => {
    expect(decide(3, true)).toBe("exhausted");
  });

  it("finishes a cycle without progress instead of continuing", () => {
    expect(decide(2, false)).toBe("finish");
  });

  it("labels a text-only user observation as reported and not independently checked", () => {
    const reported = userObservation({
      observationId: "o-3",
      testId: "t-2",
      verdict: "supports",
      quote: "Tides followed the moon",
      receivedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(reported).toMatchObject({ producer: "user", citationTokens: [] });
    expect(reported.limitations).toEqual([USER_OBSERVATION_LIMITATION]);
  });

  it("labels user support with its limitations and always lists disconfirmed revisions", () => {
    const reported = userObservation({
      observationId: "o-1",
      testId: "t-1",
      verdict: "supports",
      quote: "Tides followed the moon",
      receivedAt: "2026-01-01T00:00:00.000Z",
    });
    const section = hypothesesSection({
      hypotheses: [
        { ...hypothesis, hypothesisId: "h-0", status: "disconfirmed", observationIds: ["o-2"] },
        { ...hypothesis, status: "disconfirmed", observationIds: [] },
        {
          ...hypothesis,
          revision: 2,
          previousRevision: 1,
          status: "supported",
          observationIds: ["o-1"],
        },
      ],
      tests: [],
      observations: [reported, { ...reported, observationId: "o-2", verdict: "contradicts" }],
      cycles: [],
      notes: [],
      executions: [],
      omissions: [],
    });
    expect(section).toContain("(disconfirmed) The moon drives tides. (revision 1)");
    expect(section).toContain(
      `(disconfirmed by a user observation — ${USER_OBSERVATION_LIMITATION}) The moon drives tides.`,
    );
    expect(section).toContain(
      `(supported by a user observation — ${USER_OBSERVATION_LIMITATION}) The moon drives tides. (revision 2). Alternative: Wind drives tides.`,
    );
  });

  it("keeps a late user report as inconclusive text when no discovery round remains", async () => {
    const model = new FakeChatModel([]);
    const observation = await new ResearchDiscoveryService({
      chatModel: model,
      model: "model",
      chatOptions: {},
      resolveEvidence: () => [],
      spendRound: () => false,
      createId: (prefix) => `${prefix}-1`,
      now: () => "2026-01-01T00:00:00.000Z",
    }).assessReport(hypothesis, proposed, "Tides  followed the moon");
    expect(observation).toMatchObject({
      verdict: "inconclusive",
      quote: "Tides followed the moon",
    });
    expect(model.requests).toHaveLength(0);
  });

  it("answers the test the pending decision names and rejects a superseded revision as stale", () => {
    const awaiting = (testId: string, hypothesisId: string): ResearchTest => ({
      ...proposed,
      testId,
      hypothesisId,
      kind: "supplied-observation",
      status: "awaiting-input",
    });
    const base = gatheringResearch(researchPlan([researchBranch(1)], "balanced"));
    const state = {
      ...base,
      phase: "awaiting-observation" as const,
      pending: {
        decisionId: "d-1",
        kind: "observation" as const,
        artifactRevision: 1,
        subjectId: "t-2",
      },
      discovery: {
        hypotheses: [hypothesis, { ...hypothesis, hypothesisId: "h-2" }],
        tests: [awaiting("t-1", "h-1"), awaiting("t-2", "h-2")],
        observations: [],
        cycles: [],
        notes: [],
        executions: [],
        omissions: [],
      },
    };
    const decision = {
      researchId: state.researchId,
      decisionId: "d-1",
      expectedRevision: state.revision,
      payload: { action: "observe", text: "Seen" },
    };
    expect(suppliedObservation(state, decision)).toEqual({ testId: "t-2", text: "Seen" });
    const revised = {
      ...state,
      discovery: {
        ...state.discovery,
        hypotheses: [
          ...state.discovery.hypotheses,
          { ...hypothesis, hypothesisId: "h-2", revision: 2 },
        ],
      },
    };
    expect(() => suppliedObservation(revised, decision)).toThrow("no longer matches the research");
  });

  it("sends only a supported hypothesis with source tokens to verification", () => {
    const discovery = (status: ResearchHypothesis["status"]) => ({
      hypotheses: [{ ...hypothesis, status, observationIds: ["o-1"] }],
      tests: [],
      observations: [observation("o-1", "supports")],
      cycles: [],
      notes: [],
      executions: [],
      omissions: [],
    });
    expect(hypothesisClaims(discovery("disconfirmed"), 40)).toEqual([]);
    expect(hypothesisClaims(discovery("supported"), 40)).toMatchObject([
      { kind: "hypothesis", workId: "t-1", citationTokens: ["e1"] },
    ]);
  });

  it("ends the cycle as exhausted with a note when an assessment round is refused", async () => {
    const plan = researchPlan([researchBranch(1)], "thorough");
    const execution = {
      workId: "t-1",
      branchId: "branch-1",
      state: "completed" as const,
      path: "main" as const,
      attempts: 2,
      finding: { text: "F", citationTokens: [], partial: false },
      terminalReason: null,
    };
    const start = {
      hypotheses: [hypothesis],
      tests: [proposed],
      observations: [],
      cycles: [{ ordinal: 1, workIds: [], decision: "continue" as const, reason: "Gathered" }],
      notes: [],
      executions: [execution],
      omissions: [],
    };
    const phase = (discovery: typeof start, tests = discovery.tests) =>
      runDiscoveryPhase({
        question: "Q",
        plan,
        gathered: [],
        discovery: { ...discovery, tests },
        service: { assess: async () => null } as unknown as ResearchDiscoveryService,
        runTests: async (executions) => executions,
        commit: async () => undefined,
        budgetClosed: () => false,
        aborted: () => false,
      });

    const refused = await phase(start);
    expect(refused.decision).toBe("exhausted");
    expect(refused.discovery.cycles.at(-1)).toMatchObject({
      reason: "No discovery round remains.",
    });
    expect(refused.discovery.tests[0]!.status).toBe("unavailable");
    expect(refused.discovery.notes).toHaveLength(1);
    const full = Array.from({ length: 8 }, (_, index) => ({
      ...proposed,
      testId: `t-${index + 9}`,
      status: "unavailable" as const,
    }));
    const noRoom = await phase(start, full);
    expect(noRoom.discovery.cycles.at(-1)!.reason).toBe("No room for more hypotheses.");
  });

  it("disconfirms only on a contradicting quote found in a passage of the test's own tokens", async () => {
    const passage = "Tides kept their times when the moon was hidden for weeks.";
    const rows: [string, ResearchObservation["verdict"]][] = [
      ["Tides kept their times when the moon was hidden", "contradicts"],
      ["Tides were measured by wind gauges on the coast", "inconclusive"],
    ];
    for (const [quote, expected] of rows) {
      const model = new FakeChatModel([
        [{ content: JSON.stringify({ verdict: "contradicts", quote }), isComplete: true }],
      ]);
      const observed = await new ResearchDiscoveryService({
        chatModel: model,
        model: "model",
        chatOptions: {},
        resolveEvidence: (tokens) =>
          tokens.map((token) => retrieved(token, markdownSource("Notes/tides.md"), passage)),
        spendRound: () => true,
        createId: (prefix) => `${prefix}-1`,
        now: () => "2026-01-01T00:00:00.000Z",
      }).assess(hypothesis, proposed, { text: "F [e1]", citationTokens: ["e1"], partial: false });
      expect(observed!.verdict, quote).toBe(expected);
      const reduced = reduceHypothesis({ ...hypothesis, observationIds: ["observation-1"] }, [
        observed!,
      ]);
      expect(reduced.status, quote).toBe(
        expected === "contradicts" ? "disconfirmed" : "inconclusive",
      );
    }
  });

  it("stores an over-long proposed claim within the bound the state reader accepts", () => {
    const plan = researchPlan([researchBranch(1)], "balanced");
    const reply = JSON.stringify({
      hypotheses: [
        { ...hypothesis, branch: 1, claim: "c".repeat(280), test: { kind: "literature" } },
      ],
    });
    const parsed = parseHypothesisProposals(reply, plan, [], 8);
    const planned = new ResearchDiscoveryService({
      chatModel: new FakeChatModel([]),
      model: "model",
      chatOptions: {},
      resolveEvidence: () => [],
      spendRound: () => true,
      createId: (prefix) => `${prefix}-1`,
      now: () => "2026-01-01T00:00:00.000Z",
    }).plan(parsed.proposals, []);
    const base = gatheringResearch(plan);
    const state = {
      ...base,
      phase: "discovering" as const,
      discovery: {
        ...planned,
        observations: [],
        cycles: [{ ordinal: 1, workIds: [], decision: "continue" as const, reason: "Gathered" }],
        notes: [],
        omissions: [],
      },
    };
    expect(validateResearchSection({ schema: 1, active: state, history: [] }).ok).toBe(true);
  });
});
