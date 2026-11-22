import { EvidenceVerificationService } from "@application/use-cases/research/deep-research";
import {
  acceptedAssessment,
  independenceGroups,
  objectiveCoverage,
  type ResearchClaim,
} from "@core/research/deepResearch";
import { gatheringResearch, researchBranch, researchPlan } from "../support/deepResearch";
import { markdownSource, retrieved, webSource } from "../support/factories";
import { FakeChatModel } from "../support/researchFakes";

const claim: ResearchClaim = {
  claimId: "c-1",
  branchId: "branch-1",
  objective: "Objective",
  text: "The moon causes tides.",
  citationTokens: ["t1"],
};
const supported = {
  claimId: "c-1",
  verdict: "supported" as const,
  quote: "x",
  contradictingTokens: [],
  independenceGroups: [],
};

describe("deep research claim verification", () => {
  it("settles a claim with no resolvable token as unsupported without an assessment call", async () => {
    const model = new FakeChatModel([
      [
        {
          content: JSON.stringify({
            claims: [{ finding: 1, text: "Forged claim", tokens: ["t-forged"], objective: 1 }],
          }),
          isComplete: true,
        },
      ],
    ]);
    const plan = researchPlan([researchBranch(1)], "balanced");
    const execution = {
      ...gatheringResearch(plan).executions[0]!,
      state: "completed" as const,
      finding: { text: "Forged claim [t-forged]", citationTokens: ["t-forged"], partial: false },
    };
    const summary = await new EvidenceVerificationService({
      chatModel: model,
      model: "model",
      chatOptions: {},
      resolveEvidence: () => [],
      spendRound: () => true,
      followUpsRemaining: 0,
      followUpCycle: 1,
    }).verify([execution], plan);

    expect(summary.assessments).toMatchObject([{ verdict: "unsupported", quote: null }]);
    expect(model.requests).toHaveLength(1);
  });

  it("accepts a contradicting token only from the assessment request of the claim", async () => {
    const plan = researchPlan([researchBranch(1)], "balanced");
    const claims = Array.from({ length: 11 }, (_, index) => ({
      finding: 1,
      text: `Claim ${index + 1}`,
      tokens: [index === 10 ? "t2" : "t1"],
      objective: 1,
    }));
    const conflicted = JSON.stringify({
      assessments: Array.from({ length: 10 }, (_, index) => ({
        claim: index + 1,
        verdict: "conflicted",
        contradicting: ["t2"],
      })),
    });
    const model = new FakeChatModel([
      [{ content: JSON.stringify({ claims }), isComplete: true }],
      [{ content: conflicted, isComplete: true }],
      [{ content: conflicted, isComplete: true }],
    ]);
    const execution = {
      ...gatheringResearch(plan).executions[0]!,
      state: "completed" as const,
      finding: { text: "Claims [t1] [t2]", citationTokens: ["t1", "t2"], partial: false },
    };
    const summary = await new EvidenceVerificationService({
      chatModel: model,
      model: "model",
      chatOptions: {},
      resolveEvidence: () => [
        retrieved("t1", markdownSource("Notes/a.md"), "First passage text."),
        retrieved("t2", markdownSource("Notes/b.md"), "Second passage text."),
      ],
      spendRound: () => true,
      followUpsRemaining: 0,
      followUpCycle: 1,
    }).verify([execution], plan);

    expect(summary.assessments.map((entry) => entry.verdict)).toEqual([
      ...Array.from({ length: 10 }, () => "unresolved"),
      "conflicted",
    ]);
  });

  it("downgrades verdicts the cited passages of the request do not bear out", () => {
    const passages = new Map([["t1", "The moon pulls the oceans twice every day."]]);
    const rows: [string, object, string][] = [
      [
        "quote outside the passage",
        { verdict: "supported", quote: "The sun causes tides here" },
        "unresolved",
      ],
      [
        "quote under twenty characters",
        { verdict: "supported", quote: "the oceans" },
        "unresolved",
      ],
      [
        "contained quote",
        { verdict: "supported", quote: "pulls the  OCEANS twice every" },
        "supported",
      ],
      ["conflict without a token", { verdict: "conflicted", contradicting: [] }, "unresolved"],
      [
        "conflict from another request",
        { verdict: "conflicted", contradicting: ["t9"] },
        "unresolved",
      ],
      [
        "conflict from this request",
        { verdict: "conflicted", contradicting: ["t1"] },
        "conflicted",
      ],
    ];
    for (const [label, verdict, expected] of rows) {
      const raw = { verdict: undefined, quote: undefined, contradicting: undefined, ...verdict };
      expect(acceptedAssessment(claim, raw, passages, new Map()).verdict, label).toBe(expected);
    }
  });

  it("groups syndicated copies of one text as one source", () => {
    const copy = (id: string, url: string) => ({
      ...retrieved(id, webSource(url), "Same article"),
      contentHash: "hash-article",
    });
    const groups = independenceGroups([
      copy("t1", "https://www.news.example/story?utm_source=x"),
      copy("t2", "https://mirror.example/reprint"),
    ]);
    expect(groups.get("t1")).toBe(groups.get("t2"));
  });

  it("keeps distinct sources in distinct groups", () => {
    const groups = independenceGroups([
      retrieved("t1", markdownSource("Notes/a.md"), "A"),
      retrieved("t2", markdownSource("Notes/b.md"), "B"),
    ]);
    expect(groups.get("t1")).not.toBe(groups.get("t2"));
  });

  it("covers an objective served by a supported claim", () => {
    expect(objectiveCoverage(["Objective"], [claim], [supported])).toEqual([
      { objective: "Objective", covered: true },
    ]);
  });

  it("leaves an objective uncovered when its only claim is not supported", () => {
    const unresolved = { ...supported, verdict: "unresolved" as const };
    expect(objectiveCoverage(["Objective"], [claim], [unresolved])).toEqual([
      { objective: "Objective", covered: false },
    ]);
  });
});
