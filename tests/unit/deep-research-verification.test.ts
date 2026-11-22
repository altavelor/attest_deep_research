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

  it("downgrades a supported verdict whose quote is not in the cited passage", () => {
    const passages = new Map([["t1", "The moon pulls the oceans."]]);
    const verdict = { verdict: "supported", quote: "The sun causes tides", contradicting: [] };
    expect(acceptedAssessment(claim, verdict, passages, new Map()).verdict).toBe("unresolved");
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
