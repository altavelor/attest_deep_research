import {
  USER_OBSERVATION_LIMITATION,
  acceptHypothesisDraft,
  hypothesesSection,
  nextCycleDecision,
  reduceHypothesis,
  userObservation,
  type ResearchHypothesis,
  type ResearchObservation,
  type ResearchTest,
} from "@core/research/deepResearch";

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
      quote: null,
      citationTokens: [],
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
      quote: null,
      citationTokens: [],
      receivedAt: "2026-01-01T00:00:00.000Z",
    });
    const section = hypothesesSection({
      hypotheses: [
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
      observations: [reported],
      cycles: [],
      notes: [],
      executions: [],
      omissions: [],
    });
    expect(section).toContain("(disconfirmed) The moon drives tides. (revision 1)");
    expect(section).toContain(
      `(supported by a user observation, ${USER_OBSERVATION_LIMITATION}) The moon drives tides. (revision 2). Alternative: Wind drives tides.`,
    );
  });
});
