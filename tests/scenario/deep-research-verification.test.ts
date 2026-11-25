import type { ChatModelProvider, ChatRequest, ChatResponseChunk } from "@core/agent";
import { finishedResearchReport } from "@application/use-cases/research/deep-research";
import {
  nextResearchSection,
  validateResearchSection,
  type ResearchPlan,
} from "@core/research/deepResearch";
import { collectAsync } from "../support/async";
import {
  BranchModelRounds,
  MemoryResearchState,
  ResearchRegistry,
  cooperativeResearchReply,
  deepResearchService,
  gatheringResearch,
  researchBranch,
  researchPlan,
} from "../support/deepResearch";
import { markdownSource, retrieved } from "../support/factories";
import { FakeRetriever } from "../support/researchFakes";

class FirstAssessmentFailsModel implements ChatModelProvider {
  readonly requests: ChatRequest[] = [];
  private assessments = 0;

  constructor(private readonly claimsPerFinding = 1) {}

  async listModels(): Promise<string[]> {
    return ["model"];
  }

  async *streamChat(request: ChatRequest): AsyncIterable<ChatResponseChunk> {
    this.requests.push(request);
    const assess = String(request.messages[0]?.content).startsWith("You check claims");
    if (assess && (this.assessments += 1) === 1) {
      yield { content: "{}", isComplete: true };
      return;
    }
    if (
      this.claimsPerFinding > 1 &&
      String(request.messages[0]?.content).startsWith("You extract")
    ) {
      const user = String(request.messages.at(-1)?.content);
      const findings = [...user.matchAll(/<finding id="(\d+)">\n[^\n]*\[([^\]\s]+)\]/gu)];
      const claims = findings.flatMap((match) =>
        Array.from({ length: this.claimsPerFinding }, (_, index) => ({
          finding: Number(match[1]),
          text: `Claim ${match[1]}.${index + 1}`,
          tokens: [match[2]],
          objective: 1,
        })),
      );
      yield { content: JSON.stringify({ claims }), isComplete: true };
      return;
    }
    yield { content: cooperativeResearchReply(request) ?? "# Summary\n\nTides.", isComplete: true };
  }
}

async function runVerified(plan: ResearchPlan, model: FirstAssessmentFailsModel) {
  const state = gatheringResearch(plan);
  const port = new MemoryResearchState();
  port.commits.push(state);
  const rounds = new BranchModelRounds();
  const registry = new ResearchRegistry();
  await collectAsync(
    deepResearchService(model, {
      retriever: new FakeRetriever({
        chunks: [
          retrieved("chunk-1", markdownSource("Notes/tides.md"), "The moon pulls the oceans."),
        ],
        citations: [],
        usedFallback: false,
      }),
      modelRound: rounds,
      now: () => new Date("2026-01-01T01:00:00.000Z"),
    }).answer({
      question: "Continue",
      mode: "deep-research",
      researchState: port,
      research: { type: "continue", researchId: state.researchId },
      finalizeAnswer: registry.finalizeAnswer,
      resolveEvidence: registry.resolveEvidence,
    }),
  );
  return { port, rounds };
}

function roundTrip(section: unknown) {
  return validateResearchSection(JSON.parse(JSON.stringify(section)));
}

describe("deep research verification", () => {
  it("follows up an uncovered objective once, re-verifies only the new finding and reports the rest", async () => {
    const plan = researchPlan(
      [researchBranch(1), researchBranch(2, { objectives: ["Second"] })],
      "balanced",
      { objectives: ["Objective", "Second"] },
    );
    const model = new FirstAssessmentFailsModel();
    const { port, rounds } = await runVerified(plan, model);

    const final = port.commits.at(-1)!;
    const verification = [...port.commits]
      .reverse()
      .find((entry) => entry.verification)!.verification!;
    expect(verification.followUpsUsed).toBe(1);
    expect(verification.followUps).toMatchObject([
      { workId: "branch-1-follow-up-1", state: "completed" },
    ]);
    expect(rounds.tasks.filter((task) => task.startsWith("Follow up on"))).toHaveLength(1);
    const extracts = model.requests.filter((request) =>
      String(request.messages[0]?.content).startsWith("You extract"),
    );
    expect(
      extracts.map(
        (request) => String(request.messages.at(-1)?.content).split("<finding").length - 1,
      ),
    ).toEqual([2, 1]);
    expect(verification.coverage).toEqual([
      { objective: "Objective", covered: true },
      { objective: "Second", covered: false },
    ]);
    expect(final.report).toMatchObject({
      quality: "partial",
      verification: {
        supported: 1,
        unresolved: 2,
        uncoveredObjectives: ["Second"],
        coveredObjectives: 1,
      },
    });
    expect(final.report!.markdown).toContain("## Unsupported or unresolved claims");
    expect(final.report!.markdown).toContain("## Uncovered objectives\n\n- Second");
  });

  it("keeps the claims of every verification round within the stored bound", async () => {
    const plan = researchPlan(
      [1, 2, 3, 4].map((index) =>
        researchBranch(index, index === 4 ? { objectives: ["Second"] } : {}),
      ),
      "balanced",
      { objectives: ["Objective", "Second"] },
    );
    const { port } = await runVerified(plan, new FirstAssessmentFailsModel(12));

    for (const state of port.commits.slice(0, -1)) {
      expect(roundTrip({ schema: 1, active: state, history: [] }).ok, state.phase).toBe(true);
    }
    const final = port.commits.at(-1)!;
    const verification = [...port.commits]
      .reverse()
      .find((entry) => entry.verification)!.verification!;
    expect(verification.followUpsUsed).toBe(1);
    expect(verification.claims.length).toBeLessThanOrEqual(40);
    expect(verification.verifiedWorks).not.toContain("branch-4-gather-1");
    expect(final.report!.markdown).toContain("## Unverified findings");
    const read = roundTrip(nextResearchSection(null, final));
    const view = read.ok
      ? { status: "ready" as const, active: read.value.active, history: read.value.history }
      : { status: "unreadable" as const, reason: read.message };
    const message = {
      role: "assistant" as const,
      content: final.report!.markdown,
      createdAt: final.updatedAt,
      research: {
        researchId: final.researchId,
        artifact: "plan" as const,
        revision: final.revision,
      },
    };
    expect(finishedResearchReport(view, [message], final.researchId)).toMatchObject({
      reportId: final.report!.reportId,
      verification: { supported: final.report!.verification!.supported },
    });
  });
});
