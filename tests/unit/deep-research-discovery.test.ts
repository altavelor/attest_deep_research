import { ENGLISH_RESEARCH_LABELS } from "@core/research/deepResearch";
import {
  USER_OBSERVATION_LIMITATION,
  acceptHypothesisDraft,
  hypothesesSection,
  parseHypothesisProposals,
  validateResearchSection,
  contestedPoints,
  cycleDecisionReason,
  nextCycleDecision,
  reduceHypothesis,
  testWorkTask,
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
  it("lists the unread sources as framed data in the test task and omits the block without them", () => {
    const withGaps = testWorkTask(hypothesis, proposed, ["https://e.test/a?x=<b>"]);
    expect(withGaps).toContain("<unread-sources>\nhttps://e.test/a?x=&lt;b>\n</unread-sources>");
    expect(withGaps).toContain("find_in_pages");
    expect(testWorkTask(hypothesis, proposed)).not.toContain("unread-sources");
  });

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

  it("stops as exhausted at the cycle cap or a closed budget and says which", () => {
    expect(decide(3, true)).toBe("exhausted");
    const input = {
      cycle: 3,
      researchCycles: 3,
      budgetClosed: true,
      hypotheses: [hypothesis],
      tests: [proposed],
      progressed: true,
    };
    expect(cycleDecisionReason("exhausted", input)).toBe(
      "All 3 planned cycles ran; 1 hypotheses stay open.",
    );
    expect(cycleDecisionReason("exhausted", { ...input, cycle: 2 })).toBe(
      "The research budget closed; 1 hypotheses stay open.",
    );
  });

  it("never waits for a user observation once the user skipped observations", () => {
    const awaiting = {
      ...proposed,
      kind: "supplied-observation" as const,
      status: "awaiting-input" as const,
    };
    const input = {
      cycle: 2,
      researchCycles: 3,
      budgetClosed: false,
      hypotheses: [hypothesis],
      tests: [awaiting],
      progressed: true,
    };
    expect(nextCycleDecision(input)).toBe("await-observation");
    expect(nextCycleDecision({ ...input, observationsSkipped: true })).toBe("continue");
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

  it("labels user support with its limitations and lists disconfirmed revisions without a skip label", () => {
    const reported = userObservation({
      observationId: "o-1",
      testId: "t-1",
      verdict: "supports",
      quote: "Tides followed the moon",
      receivedAt: "2026-01-01T00:00:00.000Z",
    });
    const section = hypothesesSection(
      {
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
        tests: [{ ...proposed, kind: "supplied-observation", status: "unavailable" }],
        observationsSkipped: true,
        observations: [reported, { ...reported, observationId: "o-2", verdict: "contradicts" }],
        cycles: [],
        notes: [],
        executions: [],
        omissions: [],
      },
      ENGLISH_RESEARCH_LABELS,
    );
    expect(section).toContain("- (disconfirmed) The moon drives tides. (revision 1)");
    expect(section).toContain(
      `(disconfirmed by a user observation — ${USER_OBSERVATION_LIMITATION}) The moon drives tides.`,
    );
    expect(section).toContain(
      `(supported by a user observation — ${USER_OBSERVATION_LIMITATION}) The moon drives tides. (revision 2). Alternative: Wind drives tides.`,
    );
  });

  it("asks for the contradictions between the whole findings within a bounded output", async () => {
    const model = new FakeChatModel([[{ content: '{"hypotheses": []}', isComplete: true }]]);
    const plan = researchPlan([researchBranch(1)], "balanced");
    const findings = [
      {
        ...gatheringResearch(plan).executions[0]!,
        finding: { text: `${"a".repeat(11_000)}END`, citationTokens: [], partial: false },
      },
    ];
    await new ResearchDiscoveryService({
      chatModel: model,
      model: "model",
      chatOptions: { maxTokens: 131_072 },
      resolveEvidence: () => [],
      spendRound: () => true,
      createId: (prefix) => `${prefix}-1`,
      now: () => "2026-01-01T00:00:00.000Z",
    }).propose("Tides?", plan, findings, [], 3);

    expect(String(model.requests[0]!.messages[0]!.content)).toContain("contradictions");
    expect(String(model.requests[0]!.messages.at(-1)!.content)).toContain("END");
    expect(model.requests[0]!.maxTokens).toBe(24_000);
    const unset = new FakeChatModel([[{ content: '{"hypotheses": []}', isComplete: true }]]);
    await new ResearchDiscoveryService({
      chatModel: unset,
      model: "model",
      chatOptions: {},
      resolveEvidence: () => [],
      spendRound: () => true,
      createId: (prefix) => `${prefix}-1`,
      now: () => "2026-01-01T00:00:00.000Z",
    }).propose("Tides?", plan, findings, [], 3);
    expect(unset.requests[0]!.maxTokens).toBe(24_000);
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

  it("lists every current hypothesis as a contested point with the quotes and tokens of its source observations", () => {
    const discovery = {
      hypotheses: [
        { ...hypothesis, status: "disconfirmed" as const, observationIds: ["o-1", "o-2"] },
      ],
      tests: [],
      observations: [
        observation("o-1", "contradicts"),
        { ...observation("o-2", "supports"), producer: "user" as const, quote: "Own result" },
      ],
      cycles: [],
      notes: [],
      executions: [],
      omissions: [],
    };

    expect(contestedPoints(discovery)).toEqual([
      {
        claim: "The moon drives tides.",
        alternative: "Wind drives tides.",
        status: "disconfirmed",
        quotes: ["Tides follow the moon closely."],
        userReports: ["Own result"],
        citationTokens: ["e1"],
      },
    ]);
    expect(contestedPoints(null)).toEqual([]);
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

  it("gives a check the unread sources its branch found and no other branch's", async () => {
    const plan = researchPlan([researchBranch(1), researchBranch(2)], "thorough");
    const finding = (unreadSources: string[]) => ({
      text: "F",
      citationTokens: [],
      partial: false,
      unreadSources,
    });
    const gathered = [
      { workId: "g-1", branchId: "branch-1", state: "completed" as const, path: "main" as const },
      { workId: "g-2", branchId: "branch-2", state: "completed" as const, path: "main" as const },
    ].map((entry, index) => ({
      ...entry,
      attempts: 1,
      terminalReason: null,
      finding: finding([`https://e.test/branch-${index + 1}`]),
    }));
    const tasks: string[] = [];
    await runDiscoveryPhase({
      question: "Q",
      plan,
      gathered,
      discovery: {
        hypotheses: [hypothesis],
        tests: [proposed],
        observations: [],
        cycles: [{ ordinal: 1, workIds: [], decision: "continue" as const, reason: "Gathered" }],
        notes: [],
        executions: [
          {
            workId: "t-1",
            branchId: "branch-1",
            state: "pending",
            path: null,
            attempts: 0,
            finding: null,
            terminalReason: null,
          },
        ],
        omissions: [],
      },
      service: { assess: async () => null } as unknown as ResearchDiscoveryService,
      runTests: async (executions, works) => {
        tasks.push(...works.map((work) => work.task));
        return executions;
      },
      commit: async () => undefined,
      budgetClosed: () => false,
      aborted: () => false,
    });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toContain("https://e.test/branch-1");
    expect(tasks[0]).not.toContain("https://e.test/branch-2");
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
        { ...hypothesis, branch: 1, claim: "c".repeat(700), test: { kind: "literature" } },
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
    expect(planned.hypotheses[0]!.claim).toHaveLength(600);
  });

  it("never cites or quotes registry sources a user report names", async () => {
    const model = new FakeChatModel([
      [{ content: JSON.stringify({ verdict: "supports" }), isComplete: true }],
    ]);
    const observation = await new ResearchDiscoveryService({
      chatModel: model,
      model: "model",
      chatOptions: {},
      resolveEvidence: (tokens) =>
        tokens.map((token) => retrieved(token, markdownSource("Notes/a.md"), "Registry passage.")),
      spendRound: () => true,
      createId: (prefix) => `${prefix}-1`,
      now: () => "2026-01-01T00:00:00.000Z",
    }).assessReport(hypothesis, proposed, "It held [source-1:revision-1].");
    expect(observation).toMatchObject({
      citationTokens: [],
      limitations: [USER_OBSERVATION_LIMITATION],
    });
    expect(JSON.stringify(model.requests)).not.toContain("Registry passage");
  });
});
